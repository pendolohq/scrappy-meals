import { eq, inArray, sql } from "drizzle-orm";

import "server-only";

import type { Db } from "../db/client";
import { usdaFoodMatches, usdaFoods, usdaSuggestMisses } from "../db/schema";
import { OWN_VALUES, type UsdaFood, type UsdaPortion } from "../domain/usda";
import type { FoodMatch } from "../domain/usda-check";
import type { Macros } from "../mealie/nutrition";

export type StoredMatch = FoodMatch & {
  foodName: string;
  pieceLabel: string | null;
};

const toFood = (row: typeof usdaFoods.$inferSelect): UsdaFood => ({
  fdcId: row.fdcId,
  description: row.description,
  dataType: row.dataType,
  per100g: row.per100g,
  portions: row.portions,
});

/**
 * The foods by id, from our cache; only the ones it doesn't have are fetched
 * from FDC and stored. A food FDC doesn't know is left out.
 */
export async function ensureFoods(
  db: Db,
  client: { foods: (ids: number[]) => Promise<UsdaFood[]> },
  ids: number[]
): Promise<Map<number, UsdaFood>> {
  const wanted = [...new Set(ids)];
  const found = new Map<number, UsdaFood>();
  if (wanted.length === 0) {
    return found;
  }
  const rows = await db
    .select()
    .from(usdaFoods)
    .where(inArray(usdaFoods.fdcId, wanted));
  for (const row of rows) {
    found.set(row.fdcId, toFood(row));
  }
  const missing = wanted.filter((id) => !found.has(id));
  if (missing.length > 0) {
    const fetched = await client.foods(missing);
    if (fetched.length > 0) {
      const now = new Date();
      await db
        .insert(usdaFoods)
        .values(fetched.map((f) => ({ ...f, fetchedAt: now })))
        .onConflictDoNothing();
    }
    for (const food of fetched) {
      found.set(food.fdcId, food);
    }
  }
  return found;
}

/**
 * Saves values typed in by hand as a food alongside the cached USDA ones, with
 * a negative id so it can never clash with an FDC id. `current` is the food
 * the match points at now: one of these is updated in place, so each Mealie
 * food keeps a single row. Returns the food's id.
 */
export async function saveOwnFood(
  db: Db,
  input: {
    current: number | null;
    description: string;
    per100g: Macros;
    portions: UsdaPortion[];
  }
): Promise<number> {
  const values = {
    description: input.description,
    dataType: OWN_VALUES,
    per100g: input.per100g,
    portions: input.portions,
    fetchedAt: new Date(),
  };
  if (input.current !== null && input.current < 0) {
    await db
      .update(usdaFoods)
      .set(values)
      .where(eq(usdaFoods.fdcId, input.current));
    return input.current;
  }
  const [row] = await db
    .insert(usdaFoods)
    .values({
      ...values,
      fdcId: sql`least(0, (select coalesce(min(${usdaFoods.fdcId}), 0) from ${usdaFoods})) - 1`,
    })
    .returning({ fdcId: usdaFoods.fdcId });
  return row!.fdcId;
}

/** Every saved match with its cached USDA food, by Mealie food id. */
export async function listMatches(db: Db): Promise<Map<string, StoredMatch>> {
  const rows = await db
    .select()
    .from(usdaFoodMatches)
    .innerJoin(usdaFoods, eq(usdaFoodMatches.fdcId, usdaFoods.fdcId));
  return new Map(
    rows.map(({ usda_food_matches: m, usda_foods: f }) => [
      m.mealieFoodId,
      {
        fdcId: m.fdcId,
        status: m.status,
        pieceGrams: m.pieceGrams,
        pieceLabel: m.pieceLabel,
        unitGrams: m.unitGrams,
        defaultGrams: m.defaultGrams,
        foodName: m.foodName,
        food: toFood(f),
      },
    ])
  );
}

export type MatchInput = {
  mealieFoodId: string;
  foodName: string;
  fdcId: number;
  status: "suggested" | "confirmed";
  pieceGrams: number | null;
  pieceLabel: string | null;
  unitGrams: Record<string, number>;
  defaultGrams: number | null;
};

/** Saves the match for a food, replacing the one it had. The USDA food must be cached. */
export async function saveMatch(
  db: Db,
  match: MatchInput,
  userId: string
): Promise<void> {
  const values = { ...match, updatedBy: userId };
  // $onUpdate doesn't run for an upsert's update, so updatedAt is set here.
  await db
    .insert(usdaFoodMatches)
    .values(values)
    .onConflictDoUpdate({
      target: usdaFoodMatches.mealieFoodId,
      set: { ...values, updatedAt: new Date() },
    });
}

/**
 * Saves Claude's suggestion for a food unless it has a match by now, so a
 * match someone confirmed meanwhile is never replaced. True when it was saved.
 */
export async function saveSuggestion(
  db: Db,
  match: Omit<
    MatchInput,
    "status" | "pieceGrams" | "pieceLabel" | "unitGrams" | "defaultGrams"
  >,
  userId: string
): Promise<boolean> {
  const saved = await db
    .insert(usdaFoodMatches)
    .values({
      ...match,
      status: "suggested",
      pieceGrams: null,
      pieceLabel: null,
      updatedBy: userId,
    })
    .onConflictDoNothing()
    .returning({ id: usdaFoodMatches.mealieFoodId });
  return saved.length > 0;
}

/** Foods Claude has already tried and found nothing for. */
export async function listSuggestMisses(db: Db): Promise<Set<string>> {
  const rows = await db.select().from(usdaSuggestMisses);
  return new Set(rows.map((r) => r.mealieFoodId));
}

export async function saveSuggestMisses(
  db: Db,
  foodIds: string[]
): Promise<void> {
  if (foodIds.length === 0) {
    return;
  }
  await db
    .insert(usdaSuggestMisses)
    .values(foodIds.map((mealieFoodId) => ({ mealieFoodId })))
    .onConflictDoNothing();
}

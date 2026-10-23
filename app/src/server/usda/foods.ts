import { eq, inArray } from "drizzle-orm";

import "server-only";

import type { Db } from "../db/client";
import { usdaFoodMatches, usdaFoods } from "../db/schema";
import type { UsdaFood } from "../domain/usda";
import type { FoodMatch } from "../domain/usda-check";

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
};

/** Saves the match for a food, replacing the one it had. The USDA food must be cached. */
export async function saveMatch(
  db: Db,
  match: MatchInput,
  userId: string
): Promise<void> {
  const values = { ...match, updatedBy: userId };
  await db.insert(usdaFoodMatches).values(values).onConflictDoUpdate({
    target: usdaFoodMatches.mealieFoodId,
    set: values,
  });
}

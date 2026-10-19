import { and, asc, eq, gte, lte, sql } from "drizzle-orm";

import type { Db } from "./db/client";
import { mealSlots, mealSlotType, slotPortions, users } from "./db/schema";
import { addDays, weekDays } from "./domain/week";
import { type CachedRecipe, loadRecipes, type RecipeFetcher } from "./recipe-cache";

export type SlotType = (typeof mealSlotType.enumValues)[number];
export const SLOT_TYPES = mealSlotType.enumValues;

export class PlanError extends Error {
  name = "PlanError";
}

export type Member = {
  id: string;
  name: string;
  targets: { kcal: number | null; protein: number | null; carbs: number | null; fat: number | null; fibre: number | null };
  defaultFastingDays: number[];
};

export type PlannedMeal = {
  id: string;
  date: string;
  slot: SlotType;
  position: number;
  slug: string;
  baseServings: number;
  portions: Record<string, number>;
  /** Null if the recipe no longer exists in Mealie (and we have no cached copy). */
  recipe: Pick<CachedRecipe, "mealieId" | "name" | "imagePath" | "servings" | "nutrition"> | null;
};

export type WeekPlan = {
  weekStart: string;
  members: Member[];
  days: { date: string; meals: PlannedMeal[] }[];
};

export async function listMembers(db: Db): Promise<Member[]> {
  const rows = await db.select().from(users).orderBy(asc(users.createdAt));
  return rows.map((u) => ({
    id: u.id,
    name: u.name,
    targets: {
      kcal: u.targetKcal,
      protein: u.targetProteinG,
      carbs: u.targetCarbsG,
      fat: u.targetFatG,
      fibre: u.targetFibreG,
    },
    defaultFastingDays: u.defaultFastingDays,
  }));
}

export async function getWeekPlan(db: Db, weekStart: string, opts: { fetch?: RecipeFetcher } = {}): Promise<WeekPlan> {
  const end = addDays(weekStart, 6);
  const [members, slots, portions] = await Promise.all([
    listMembers(db),
    db
      .select()
      .from(mealSlots)
      .where(and(gte(mealSlots.date, weekStart), lte(mealSlots.date, end)))
      .orderBy(asc(mealSlots.date), asc(mealSlots.position)),
    db
      .select({ mealSlotId: slotPortions.mealSlotId, userId: slotPortions.userId, multiplier: slotPortions.multiplier })
      .from(slotPortions)
      .innerJoin(mealSlots, eq(mealSlots.id, slotPortions.mealSlotId))
      .where(and(gte(mealSlots.date, weekStart), lte(mealSlots.date, end))),
  ]);

  const recipes = await loadRecipes(
    db,
    slots.map((s) => s.mealieRecipeSlug),
    opts,
  );
  const portionsBySlot = new Map<string, Record<string, number>>();
  for (const p of portions) {
    const entry = portionsBySlot.get(p.mealSlotId) ?? {};
    entry[p.userId] = p.multiplier;
    portionsBySlot.set(p.mealSlotId, entry);
  }

  const meals: PlannedMeal[] = slots.map((s) => {
    const r = recipes.get(s.mealieRecipeSlug);
    return {
      id: s.id,
      date: s.date,
      slot: s.slot,
      position: s.position,
      slug: s.mealieRecipeSlug,
      baseServings: s.baseServings,
      portions: portionsBySlot.get(s.id) ?? {},
      recipe: r
        ? { mealieId: r.mealieId, name: r.name, imagePath: r.imagePath, servings: r.servings, nutrition: r.nutrition }
        : null,
    };
  });

  return {
    weekStart,
    members,
    days: weekDays(weekStart).map((date) => ({ date, meals: meals.filter((m) => m.date === date) })),
  };
}

/** Adds a recipe to a day's slot, with a portion of 1 for every member. */
export async function addMeal(
  db: Db,
  input: { date: string; slot: SlotType; slug: string; createdBy: string },
  opts: { fetch?: RecipeFetcher } = {},
): Promise<string> {
  // Fetch fresh so we only plan recipes that exist, and the cache is warm for rendering.
  const recipe = (await loadRecipes(db, [input.slug], { ...opts, force: true })).get(input.slug);
  if (!recipe) throw new PlanError(`Recipe "${input.slug}" was not found in Mealie`);

  const members = await db.select({ id: users.id }).from(users);

  // Two people adding to the same slot at once can collide on position; retry.
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        const [{ next }] = await tx
          .select({ next: sql<number>`coalesce(max(${mealSlots.position}) + 1, 0)::int` })
          .from(mealSlots)
          .where(and(eq(mealSlots.date, input.date), eq(mealSlots.slot, input.slot)));
        const [slot] = await tx
          .insert(mealSlots)
          .values({
            date: input.date,
            slot: input.slot,
            position: next,
            mealieRecipeSlug: input.slug,
            createdBy: input.createdBy,
          })
          .returning({ id: mealSlots.id });
        if (members.length > 0) {
          await tx.insert(slotPortions).values(members.map((m) => ({ mealSlotId: slot.id, userId: m.id, multiplier: 1 })));
        }
        return slot.id;
      });
    } catch (err) {
      const unique = (err as { cause?: { code?: string }; code?: string }).cause?.code ?? (err as { code?: string }).code;
      if (unique !== "23505" || attempt >= 3) throw err;
    }
  }
}

export async function setPortion(db: Db, mealSlotId: string, userId: string, multiplier: number): Promise<void> {
  if (!(multiplier >= 0 && multiplier <= 20)) throw new PlanError("Portion must be between 0 and 20");
  await db
    .insert(slotPortions)
    .values({ mealSlotId, userId, multiplier })
    .onConflictDoUpdate({ target: [slotPortions.mealSlotId, slotPortions.userId], set: { multiplier } });
}

export async function setBaseServings(db: Db, mealSlotId: string, baseServings: number): Promise<void> {
  if (!(baseServings > 0 && baseServings <= 100)) throw new PlanError("Servings must be between 0 and 100");
  await db.update(mealSlots).set({ baseServings }).where(eq(mealSlots.id, mealSlotId));
}

export async function removeMeal(db: Db, mealSlotId: string): Promise<void> {
  await db.delete(mealSlots).where(eq(mealSlots.id, mealSlotId));
}

/** The date a slot belongs to, for revalidating the right week. */
export async function mealDate(db: Db, mealSlotId: string): Promise<string | null> {
  const [row] = await db.select({ date: mealSlots.date }).from(mealSlots).where(eq(mealSlots.id, mealSlotId));
  return row?.date ?? null;
}

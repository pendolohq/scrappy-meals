import { and, asc, eq, gte, lte, sql } from "drizzle-orm";

import "server-only";

import type { Db } from "./db/client";
import {
  adherence,
  dayOverrides,
  mealSlots,
  mealSlotType,
  slotPortions,
  users,
} from "./db/schema";
import type { AdherenceStatus } from "./domain/adherence";
import { isFasting } from "./domain/fasting";
import { addDays, weekDays } from "./domain/week";
import { UserFacingError } from "./errors";
import { isMealieUnavailable } from "./mealie/client";
import {
  type CachedRecipe,
  type Defer,
  loadRecipes,
  type RecipeFetcher,
} from "./recipe-cache";

export type SlotType = (typeof mealSlotType.enumValues)[number];
export const SLOT_TYPES = mealSlotType.enumValues;

export class PlanError extends UserFacingError {
  name = "PlanError";
}

export type Member = {
  id: string;
  name: string;
  targets: {
    kcal: number | null;
    protein: number | null;
    carbs: number | null;
    fat: number | null;
    fibre: number | null;
  };
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
  /** What each person logged for this meal, by user id. */
  adherence: Record<string, { status: AdherenceStatus; note: string | null }>;
  /** Null if the recipe no longer exists in Mealie (and we have no cached copy). */
  recipe: Pick<
    CachedRecipe,
    "mealieId" | "name" | "imagePath" | "servings" | "nutrition"
  > | null;
};

export type WeekPlan = {
  weekStart: string;
  members: Member[];
  /** `fasting` maps member id -> whether they fast that day (default weekdays or a day override). */
  days: {
    date: string;
    meals: PlannedMeal[];
    fasting: Record<string, boolean>;
  }[];
  /** The week's recipes by slug, as loaded for this plan. */
  recipes: Map<string, CachedRecipe | null>;
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

export async function getWeekPlan(
  db: Db,
  weekStart: string,
  opts: { fetch?: RecipeFetcher; defer?: Defer } = {}
): Promise<WeekPlan> {
  const end = addDays(weekStart, 6);
  const inWeek = and(gte(mealSlots.date, weekStart), lte(mealSlots.date, end));
  const [members, slots, portions, overrides, logs] = await Promise.all([
    listMembers(db),
    db
      .select()
      .from(mealSlots)
      .where(inWeek)
      .orderBy(asc(mealSlots.date), asc(mealSlots.position)),
    db
      .select({
        mealSlotId: slotPortions.mealSlotId,
        userId: slotPortions.userId,
        multiplier: slotPortions.multiplier,
      })
      .from(slotPortions)
      .innerJoin(mealSlots, eq(mealSlots.id, slotPortions.mealSlotId))
      .where(inWeek),
    db
      .select()
      .from(dayOverrides)
      .where(
        and(gte(dayOverrides.date, weekStart), lte(dayOverrides.date, end))
      ),
    db
      .select({
        mealSlotId: adherence.mealSlotId,
        userId: adherence.userId,
        status: adherence.status,
        note: adherence.note,
      })
      .from(adherence)
      .innerJoin(mealSlots, eq(mealSlots.id, adherence.mealSlotId))
      .where(inWeek),
  ]);

  const recipes = await loadRecipes(
    db,
    slots.map((s) => s.mealieRecipeSlug),
    opts
  );
  const portionsBySlot = new Map<string, Record<string, number>>();
  for (const p of portions) {
    const entry = portionsBySlot.get(p.mealSlotId) ?? {};
    entry[p.userId] = p.multiplier;
    portionsBySlot.set(p.mealSlotId, entry);
  }
  const logsBySlot = new Map<string, PlannedMeal["adherence"]>();
  for (const l of logs) {
    const entry = logsBySlot.get(l.mealSlotId) ?? {};
    entry[l.userId] = { status: l.status, note: l.note };
    logsBySlot.set(l.mealSlotId, entry);
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
      adherence: logsBySlot.get(s.id) ?? {},
      recipe: r
        ? {
            mealieId: r.mealieId,
            name: r.name,
            imagePath: r.imagePath,
            servings: r.servings,
            nutrition: r.nutrition,
          }
        : null,
    };
  });

  const override = new Map(
    overrides.map((o) => [`${o.userId}|${o.date}`, o.isFasting])
  );
  return {
    weekStart,
    members,
    days: weekDays(weekStart).map((date) => ({
      date,
      meals: meals.filter((m) => m.date === date),
      fasting: Object.fromEntries(
        members.map((m) => [
          m.id,
          isFasting(
            m.defaultFastingDays,
            date,
            override.get(`${m.id}|${date}`)
          ),
        ])
      ),
    })),
    recipes,
  };
}

/** Whether `userId` fasts on `date`. */
export async function isUserFasting(
  db: Db,
  userId: string,
  date: string
): Promise<boolean> {
  const [user] = await db
    .select({ days: users.defaultFastingDays })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) {
    throw new PlanError("Unknown user");
  }
  const [o] = await db
    .select({ isFasting: dayOverrides.isFasting })
    .from(dayOverrides)
    .where(and(eq(dayOverrides.userId, userId), eq(dayOverrides.date, date)));
  return isFasting(user.days, date, o?.isFasting);
}

/**
 * Sets whether a person fasts on a day. Starting a fast sets their portions
 * for that day to 0; ending one leaves portions as they are, to adjust by hand.
 * Returns how many portions were zeroed.
 */
export async function setFasting(
  db: Db,
  userId: string,
  date: string,
  fasting: boolean
): Promise<number> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({ days: users.defaultFastingDays })
      .from(users)
      .where(eq(users.id, userId));
    if (!user) {
      throw new PlanError("Unknown user");
    }

    // Matching the weekday default needs no override row; keeps defaults editable later.
    if (isFasting(user.days, date) === fasting) {
      await tx
        .delete(dayOverrides)
        .where(
          and(eq(dayOverrides.userId, userId), eq(dayOverrides.date, date))
        );
    } else {
      await tx
        .insert(dayOverrides)
        .values({ userId, date, isFasting: fasting })
        .onConflictDoUpdate({
          target: [dayOverrides.userId, dayOverrides.date],
          set: { isFasting: fasting },
        });
    }

    if (!fasting) {
      return 0;
    }
    const zeroed = await tx
      .update(slotPortions)
      .set({ multiplier: 0 })
      .where(
        and(
          eq(slotPortions.userId, userId),
          sql`${slotPortions.multiplier} > 0`,
          sql`${slotPortions.mealSlotId} IN (SELECT ${mealSlots.id} FROM ${mealSlots} WHERE ${mealSlots.date} = ${date})`
        )
      )
      .returning({ id: slotPortions.mealSlotId });
    return zeroed.length;
  });
}

/** Adds a recipe to a day's slot: a portion of 1 for every member, 0 for anyone fasting that day. */
export async function addMeal(
  db: Db,
  input: { date: string; slot: SlotType; slug: string; createdBy: string },
  opts: { fetch?: RecipeFetcher } = {}
): Promise<string> {
  // Fetch fresh so we only plan recipes that exist, and the cache is warm for rendering.
  const recipes = await loadRecipes(db, [input.slug], {
    ...opts,
    force: true,
  }).catch((err: unknown) => {
    if (isMealieUnavailable(err)) {
      throw new PlanError(
        "Mealie isn't reachable right now. Try again in a moment."
      );
    }
    throw err;
  });
  const recipe = recipes.get(input.slug);
  if (!recipe) {
    throw new PlanError(`Recipe "${input.slug}" was not found in Mealie`);
  }

  const members = await db
    .select({ id: users.id, days: users.defaultFastingDays })
    .from(users);
  const overrides = await db
    .select()
    .from(dayOverrides)
    .where(eq(dayOverrides.date, input.date));
  const override = new Map(overrides.map((o) => [o.userId, o.isFasting]));

  // Two people adding to the same slot at once can collide on position; retry.
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        const [{ next }] = await tx
          .select({
            next: sql<number>`coalesce(max(${mealSlots.position}) + 1, 0)::int`,
          })
          .from(mealSlots)
          .where(
            and(eq(mealSlots.date, input.date), eq(mealSlots.slot, input.slot))
          );
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
          await tx.insert(slotPortions).values(
            members.map((m) => ({
              mealSlotId: slot.id,
              userId: m.id,
              multiplier: isFasting(m.days, input.date, override.get(m.id))
                ? 0
                : 1,
            }))
          );
        }
        return slot.id;
      });
    } catch (err) {
      const unique =
        (err as { cause?: { code?: string }; code?: string }).cause?.code ??
        (err as { code?: string }).code;
      if (unique !== "23505" || attempt >= 3) {
        throw err;
      }
    }
  }
}

export async function setPortion(
  db: Db,
  mealSlotId: string,
  userId: string,
  multiplier: number
): Promise<void> {
  if (!(multiplier >= 0 && multiplier <= 20)) {
    throw new PlanError("Portion must be between 0 and 20");
  }
  await db
    .insert(slotPortions)
    .values({ mealSlotId, userId, multiplier })
    .onConflictDoUpdate({
      target: [slotPortions.mealSlotId, slotPortions.userId],
      set: { multiplier },
    });
}

export async function setBaseServings(
  db: Db,
  mealSlotId: string,
  baseServings: number
): Promise<void> {
  if (!(baseServings > 0 && baseServings <= 100)) {
    throw new PlanError("Servings must be between 0 and 100");
  }
  await db
    .update(mealSlots)
    .set({ baseServings })
    .where(eq(mealSlots.id, mealSlotId));
}

export async function removeMeal(db: Db, mealSlotId: string): Promise<void> {
  await db.delete(mealSlots).where(eq(mealSlots.id, mealSlotId));
}

/** The date a slot belongs to, for revalidating the right week. */
export async function mealDate(
  db: Db,
  mealSlotId: string
): Promise<string | null> {
  const [row] = await db
    .select({ date: mealSlots.date })
    .from(mealSlots)
    .where(eq(mealSlots.id, mealSlotId));
  return row?.date ?? null;
}

/** Logs how a meal went for one person; `status: null` clears it. */
export async function setAdherence(
  db: Db,
  mealSlotId: string,
  userId: string,
  status: AdherenceStatus | null,
  note?: string | null
): Promise<void> {
  if (status === null) {
    await db
      .delete(adherence)
      .where(
        and(eq(adherence.mealSlotId, mealSlotId), eq(adherence.userId, userId))
      );
    return;
  }
  const clean = note?.trim().slice(0, 500) || null;
  if (status === "swapped" && !clean) {
    throw new PlanError("Say what you had instead");
  }
  await db
    .insert(adherence)
    .values({ mealSlotId, userId, status, note: clean })
    .onConflictDoUpdate({
      target: [adherence.mealSlotId, adherence.userId],
      set: { status, note: clean },
    });
}

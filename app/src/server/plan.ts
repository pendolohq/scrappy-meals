import { and, asc, eq, gte, lte, sql } from "drizzle-orm";

import "server-only";

import type { Db } from "./db/client";
import {
  adherence,
  dayOverrides,
  mealSlots,
  slotPortions,
  users,
} from "./db/schema";
import type { AdherenceStatus } from "./domain/adherence";
import { isFasting } from "./domain/fasting";
import { slotRank, type SlotType } from "./domain/slots";
import { addDays, weekDays } from "./domain/week";
import { UserFacingError } from "./errors";
import { getSnackSlots } from "./household";
import { isMealieUnavailable } from "./mealie/client";
import {
  type CachedRecipe,
  type Defer,
  loadRecipes,
  type RecipeFetcher,
} from "./recipe-cache";

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
  snackIndex: number;
  position: number;
  slug: string;
  baseServings: number;
  portions: Record<string, number>;
  /** What each person logged for this meal, by user id. */
  adherence: Record<string, { status: AdherenceStatus; note: string | null }>;
  /** Null if the recipe no longer exists in Mealie (and we have no cached copy). */
  recipe: Pick<
    CachedRecipe,
    | "mealieId"
    | "name"
    | "imagePath"
    | "servings"
    | "nutrition"
    | "reviewState"
    | "nutritionSource"
  > | null;
};

export type WeekPlan = {
  weekStart: string;
  members: Member[];
  /** How many snack slots the household uses a day. */
  snackSlots: number;
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
  const [members, snackSlots, slots, portions, overrides, logs] =
    await Promise.all([
      listMembers(db),
      getSnackSlots(db),
      db.select().from(mealSlots).where(inWeek),
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

  // Eating order (breakfast, morning snack, lunch, ...) isn't a column to sort by.
  const inEatingOrder = slots.toSorted(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      slotRank(a.slot, a.snackIndex) - slotRank(b.slot, b.snackIndex) ||
      a.position - b.position
  );
  const meals: PlannedMeal[] = inEatingOrder.map((s) => {
    const r = recipes.get(s.mealieRecipeSlug);
    return {
      id: s.id,
      date: s.date,
      slot: s.slot,
      snackIndex: s.snackIndex,
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
            reviewState: r.reviewState,
            nutritionSource: r.nutritionSource,
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
    snackSlots,
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

/** Whether anything is planned in the week starting `weekStart`. */
export async function hasMeals(db: Db, weekStart: string): Promise<boolean> {
  const [row] = await db
    .select({ id: mealSlots.id })
    .from(mealSlots)
    .where(
      and(
        gte(mealSlots.date, weekStart),
        lte(mealSlots.date, addDays(weekStart, 6))
      )
    )
    .limit(1);
  return Boolean(row);
}

export type MealDetail = {
  id: string;
  date: string;
  slot: SlotType;
  snackIndex: number;
  slug: string;
  baseServings: number;
  portions: Record<string, number>;
  members: Member[];
  /** Null if the recipe no longer exists in Mealie (and we have no cached copy). */
  recipe: CachedRecipe | null;
};

/**
 * One planned meal with its whole recipe, for the recipe page. The recipe
 * comes from the cache like the week's, so the page still opens while Mealie
 * is down.
 */
export async function getMeal(
  db: Db,
  mealSlotId: string,
  opts: { fetch?: RecipeFetcher; defer?: Defer } = {}
): Promise<MealDetail | null> {
  const [slot] = await db
    .select()
    .from(mealSlots)
    .where(eq(mealSlots.id, mealSlotId));
  if (!slot) {
    return null;
  }
  const [members, portions] = await Promise.all([
    listMembers(db),
    db
      .select({
        userId: slotPortions.userId,
        multiplier: slotPortions.multiplier,
      })
      .from(slotPortions)
      .where(eq(slotPortions.mealSlotId, mealSlotId)),
  ]);

  const slug = slot.mealieRecipeSlug;
  let recipe = (await loadRecipes(db, [slug], opts)).get(slug) ?? null;
  if (recipe && recipe.instructions === null) {
    // Cached before the cache kept instructions: fetch them now, or show the
    // rest of the recipe while Mealie can't be reached.
    recipe = await loadRecipes(db, [slug], { fetch: opts.fetch, force: true })
      .then((fresh) => fresh.get(slug) ?? null)
      .catch((err: unknown) => {
        console.warn(`recipe ${slug}: no instructions cached yet`, err);
        return recipe;
      });
  }

  return {
    id: slot.id,
    date: slot.date,
    slot: slot.slot,
    snackIndex: slot.snackIndex,
    slug: recipe?.slug ?? slug,
    baseServings: slot.baseServings,
    portions: Object.fromEntries(portions.map((p) => [p.userId, p.multiplier])),
    members,
    recipe,
  };
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
  input: {
    date: string;
    slot: SlotType;
    snackIndex?: number;
    slug: string;
    createdBy: string;
  },
  opts: { fetch?: RecipeFetcher } = {}
): Promise<string> {
  const snackIndex = input.snackIndex ?? 0;
  if (input.slot !== "snack" && snackIndex !== 0) {
    throw new PlanError("Only snacks have more than one slot a day");
  }
  if (input.slot === "snack" && snackIndex >= (await getSnackSlots(db))) {
    throw new PlanError("That snack slot is turned off in settings");
  }
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

  // Two people adding to the same slot at the same moment can collide on
  // position; the second then gets "Something went wrong" and adds it again.
  return db.transaction(async (tx) => {
    const [{ next }] = await tx
      .select({
        next: sql<number>`coalesce(max(${mealSlots.position}) + 1, 0)::int`,
      })
      .from(mealSlots)
      .where(
        and(
          eq(mealSlots.date, input.date),
          eq(mealSlots.slot, input.slot),
          eq(mealSlots.snackIndex, snackIndex)
        )
      );
    const [slot] = await tx
      .insert(mealSlots)
      .values({
        date: input.date,
        slot: input.slot,
        snackIndex,
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
          multiplier: isFasting(m.days, input.date, override.get(m.id)) ? 0 : 1,
        }))
      );
    }
    return slot.id;
  });
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

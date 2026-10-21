"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { userAction } from "@/server/action";
import { getDb } from "@/server/db/client";
import { ADHERENCE_STATUSES } from "@/server/domain/adherence";
import { recipeSlug } from "@/server/domain/recipe-slug";
import { MAX_SNACK_SLOTS, SLOT_TYPES } from "@/server/domain/slots";
import { addDays, isIsoDate, weekStartSchema } from "@/server/domain/week";
import {
  addMeal,
  copyWeek,
  mealDate,
  moveMeal,
  PlanError,
  removeMeal,
  removeMeals,
  setAdherence,
  setBaseServings,
  setFasting,
  setPortion,
} from "@/server/plan";
import { viewerToday } from "@/server/today";

const date = z.string().refine(isIsoDate, "invalid date");
const id = z.uuid();
const slot = z.enum(SLOT_TYPES);
const snackIndex = z
  .int()
  .min(0)
  .max(MAX_SNACK_SLOTS - 1)
  .default(0);

/**
 * Refreshes the week pages and the pages under them (a meal's recipe page,
 * shopping); returns the empty success result. `"layout"` only reaches nested
 * pages with the route pattern, not a literal path, so this covers every week:
 * they are all rendered per request anyway. The Plan page shows the same meals.
 */
function refreshWeek(day: string | null) {
  if (day) {
    revalidatePath("/week/[weekStart]", "layout");
    revalidatePath("/plan/[weekStart]", "page");
  }
  return {};
}

export const addMealAction = userAction(
  z.object({
    date,
    slot,
    snackIndex,
    slug: recipeSlug,
  }),
  async (data, user) => {
    await addMeal(getDb(), { ...data, createdBy: user.id });
    return refreshWeek(data.date);
  }
);

// The plan is shared: either person can set anyone's portion.
export const setPortionAction = userAction(
  z.object({ mealId: id, userId: id, multiplier: z.number().min(0).max(20) }),
  async (data) => {
    await setPortion(getDb(), data.mealId, data.userId, data.multiplier);
    return refreshWeek(await mealDate(getDb(), data.mealId));
  }
);

export const setServingsAction = userAction(
  // At least 0.01: the column keeps two decimals, and 0 isn't allowed.
  z.object({ mealId: id, baseServings: z.number().min(0.01).max(100) }),
  async (data) => {
    await setBaseServings(getDb(), data.mealId, data.baseServings);
    return refreshWeek(await mealDate(getDb(), data.mealId));
  }
);

export const removeMealAction = userAction(
  z.object({ mealId: id }),
  async ({ mealId }) => {
    const day = await mealDate(getDb(), mealId);
    await removeMeal(getDb(), mealId);
    return refreshWeek(day);
  }
);

export const moveMealAction = userAction(
  z.object({ mealId: id, date, slot, snackIndex }),
  async ({ mealId, ...to }) => {
    await moveMeal(getDb(), mealId, to);
    return refreshWeek(to.date);
  }
);

/** Copies last week's meals into the empty slots of `weekStart`. */
export const copyLastWeekAction = userAction(
  z.object({ weekStart: weekStartSchema }),
  async ({ weekStart }, user) => {
    const result = await copyWeek(
      getDb(),
      addDays(weekStart, -7),
      weekStart,
      user.id
    );
    refreshWeek(weekStart);
    return result;
  }
);

// A week holds a few dozen meals at most; the cap only bounds the input.
export const undoCopyAction = userAction(
  z.object({ mealIds: z.array(id).min(1).max(500) }),
  async ({ mealIds }) => {
    const day = await mealDate(getDb(), mealIds[0]);
    await removeMeals(getDb(), mealIds);
    return refreshWeek(day);
  }
);

/** Each person sets only their own fasting days. */
export const setFastingAction = userAction(
  z.object({ date, fasting: z.boolean() }),
  async (data, user) => {
    await setFasting(getDb(), user.id, data.date, data.fasting);
    return refreshWeek(data.date);
  }
);

/** Each person logs only their own meals, and only from the day itself onwards. */
export const setAdherenceAction = userAction(
  z.object({
    mealId: id,
    status: z.enum(ADHERENCE_STATUSES).nullable(),
    note: z.string().max(2000).nullish(),
  }),
  async (data, user) => {
    const day = await mealDate(getDb(), data.mealId);
    if (!day) {
      throw new PlanError("That meal no longer exists");
    }
    if (day > (await viewerToday())) {
      throw new PlanError("You can log this once the day comes");
    }
    await setAdherence(getDb(), data.mealId, user.id, data.status, data.note);
    return refreshWeek(day);
  }
);

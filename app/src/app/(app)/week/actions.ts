"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { userAction } from "@/server/action";
import { getDb } from "@/server/db/client";
import { ADHERENCE_STATUSES } from "@/server/domain/adherence";
import { MAX_SNACK_SLOTS } from "@/server/domain/slots";
import { isIsoDate, today } from "@/server/domain/week";
import {
  addMeal,
  mealDate,
  PlanError,
  removeMeal,
  setAdherence,
  setBaseServings,
  setFasting,
  setPortion,
  SLOT_TYPES,
} from "@/server/plan";

const date = z.string().refine(isIsoDate, "invalid date");
const id = z.uuid();

/**
 * Refreshes the week pages and the pages under them (a meal's recipe page,
 * shopping); returns the empty success result. `"layout"` only reaches nested
 * pages with the route pattern, not a literal path, so this covers every week:
 * they are all rendered per request anyway.
 */
function refreshWeek(day: string | null) {
  if (day) {
    revalidatePath("/week/[weekStart]", "layout");
  }
  return {};
}

export const addMealAction = userAction(
  z.object({
    date,
    slot: z.enum(SLOT_TYPES),
    snackIndex: z
      .int()
      .min(0)
      .max(MAX_SNACK_SLOTS - 1)
      .default(0),
    // Mealie's slugs; also keeps "..", "/" and the like out of its API paths.
    slug: z
      .string()
      .max(200)
      .regex(/^[a-z0-9-]+$/),
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
    if (day > today()) {
      throw new PlanError("You can log this once the day comes");
    }
    await setAdherence(getDb(), data.mealId, user.id, data.status, data.note);
    return refreshWeek(day);
  }
);

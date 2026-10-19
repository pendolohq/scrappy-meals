"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { userAction } from "@/server/action";
import { getDb } from "@/server/db/client";
import { ADHERENCE_STATUSES } from "@/server/domain/adherence";
import { isIsoDate, today, weekStartOf } from "@/server/domain/week";
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

/** Refreshes the week that `day` belongs to; returns the empty success result. */
function refreshWeek(day: string | null) {
  if (day) {
    revalidatePath(`/week/${weekStartOf(day)}`);
  }
  return {};
}

export const addMealAction = userAction(
  z.object({
    date,
    slot: z.enum(SLOT_TYPES),
    slug: z.string().min(1).max(200),
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
  z.object({ mealId: id, baseServings: z.number().positive().max(100) }),
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

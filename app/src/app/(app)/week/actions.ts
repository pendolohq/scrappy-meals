"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { isIsoDate, weekStartOf } from "@/server/domain/week";
import { addMeal, mealDate, PlanError, removeMeal, setBaseServings, setPortion, SLOT_TYPES } from "@/server/plan";

export type ActionResult = { error?: string };

const date = z.string().refine(isIsoDate, "invalid date");
const id = z.uuid();

async function run(work: (userId: string) => Promise<string | null | void>): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { error: "You are signed out. Reload the page." };
  try {
    const day = await work(session.user.id);
    if (day) revalidatePath(`/week/${weekStartOf(day)}`);
    return {};
  } catch (err) {
    if (err instanceof PlanError || err instanceof z.ZodError) {
      return { error: err instanceof z.ZodError ? "Invalid input" : err.message };
    }
    console.error(err);
    return { error: "Something went wrong. Try again." };
  }
}

export async function addMealAction(input: { date: string; slot: string; slug: string }): Promise<ActionResult> {
  return run(async (userId) => {
    const data = z
      .object({ date, slot: z.enum(SLOT_TYPES), slug: z.string().min(1).max(200) })
      .parse(input);
    await addMeal(getDb(), { ...data, createdBy: userId });
    return data.date;
  });
}

export async function setPortionAction(input: { mealId: string; userId: string; multiplier: number }) {
  return run(async () => {
    const data = z.object({ mealId: id, userId: id, multiplier: z.number().min(0).max(20) }).parse(input);
    await setPortion(getDb(), data.mealId, data.userId, data.multiplier);
    return mealDate(getDb(), data.mealId);
  });
}

export async function setServingsAction(input: { mealId: string; baseServings: number }) {
  return run(async () => {
    const data = z.object({ mealId: id, baseServings: z.number().positive().max(100) }).parse(input);
    await setBaseServings(getDb(), data.mealId, data.baseServings);
    return mealDate(getDb(), data.mealId);
  });
}

export async function removeMealAction(input: { mealId: string }) {
  return run(async () => {
    const { mealId } = z.object({ mealId: id }).parse(input);
    const day = await mealDate(getDb(), mealId);
    await removeMeal(getDb(), mealId);
    return day;
  });
}

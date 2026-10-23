import { inArray } from "drizzle-orm";

import { formatDay } from "@/lib/format";

import "server-only";

import type { Db } from "./db/client";
import { slotPortions } from "./db/schema";
import { type FitEntry, fitWeek, type PersonFit } from "./domain/plan-fit";
import { isFoodRecipe } from "./domain/taxonomy";
import { weekDays } from "./domain/week";
import { PlanError } from "./errors";
import type { Macros } from "./mealie/nutrition";
import { getWeekPlan, type PlannedMeal } from "./plan";
import { lockWeek, recordChange } from "./plan-changes";
import type { Defer, RecipeFetcher } from "./recipe-cache";

export type FitPortionsResult = {
  /** The change to undo; null when every portion was already where the fit put it. */
  changeId: string | null;
  /** How many portions changed. */
  changed: number;
  days: {
    date: string;
    people: ({ userId: string; name: string } & Pick<
      PersonFit,
      "status" | "misses" | "incomplete" | "estimated"
    >)[];
  }[];
  /** Each person's average over the fitted days, for those with targets. */
  averages: { userId: string; name: string; macros: Macros; days: number }[];
};

/**
 * A day's meals as the fitter sees them. Off-plan meals were eaten, so they
 * count without changing; a product or single food keeps its amount.
 */
export const fitEntries = (meals: PlannedMeal[]): FitEntry[] =>
  meals.map((m) => ({
    id: m.id,
    perServing: m.recipe?.nutrition.perServing ?? null,
    estimated: m.recipe?.nutritionSource === "estimated",
    baseServings: m.baseServings,
    portions: m.portions,
    locked: m.unplanned,
    fixed:
      m.recipe !== null &&
      (m.recipe.product !== null || isFoodRecipe(m.recipe.tags)),
    logged: Object.fromEntries(
      Object.entries(m.adherence).map(([id, log]) => [id, log.status])
    ),
  }));

/**
 * Fits the portions of the meals already planned on `dates` to everyone's
 * targets, as one change that can be undone. Days before `today` are left
 * alone. Only portions move, never servings or meals.
 */
export async function fitPortions(
  db: Db,
  input: {
    weekStart: string;
    dates: string[];
    today: string;
    userId: string;
  },
  opts: { fetch?: RecipeFetcher; defer?: Defer } = {}
): Promise<FitPortionsResult> {
  const week = weekDays(input.weekStart);
  if (input.dates.some((d) => !week.includes(d))) {
    throw new PlanError("That day isn't in this week");
  }
  const dates = input.dates.filter((d) => d >= input.today);
  if (dates.length === 0) {
    throw new PlanError("Those days have passed: there's nothing left to fit");
  }

  const plan = await getWeekPlan(db, input.weekStart, opts);
  const days = plan.days.filter((d) => dates.includes(d.date));
  const fit = fitWeek(
    days.map((day) => ({
      date: day.date,
      entries: fitEntries(day.meals),
      people: plan.members.map((m) => ({
        id: m.id,
        targets: m.targets,
        fasting: day.fasting[m.id] ?? false,
      })),
    }))
  );

  const updates: {
    mealSlotId: string;
    userId: string;
    multiplier: number;
    was: number;
  }[] = [];
  days.forEach((day, i) => {
    const portions = fit.days[i].fit.portions;
    for (const meal of day.meals) {
      for (const member of plan.members) {
        const was = meal.portions[member.id] ?? 0;
        const multiplier = portions[meal.id][member.id] ?? 0;
        if (multiplier !== was) {
          updates.push({
            mealSlotId: meal.id,
            userId: member.id,
            multiplier,
            was,
          });
        }
      }
    }
  });

  let changeId: string | null = null;
  if (updates.length > 0) {
    changeId = await db.transaction(async (tx) => {
      await lockWeek(tx, input.weekStart);
      // The fit was worked out before the lock: if one of its portions moved
      // (or its meal went) meanwhile, it would overwrite someone's edit.
      const now = await tx
        .select()
        .from(slotPortions)
        .where(
          inArray(slotPortions.mealSlotId, [
            ...new Set(updates.map((u) => u.mealSlotId)),
          ])
        );
      const current = new Map(
        now.map((p) => [`${p.mealSlotId}|${p.userId}`, p.multiplier])
      );
      if (
        updates.some(
          (u) => current.get(`${u.mealSlotId}|${u.userId}`) !== u.was
        )
      ) {
        throw new PlanError(
          "The plan changed while fitting it. Try again in a moment."
        );
      }
      for (const u of updates) {
        await tx
          .insert(slotPortions)
          .values({
            mealSlotId: u.mealSlotId,
            userId: u.userId,
            multiplier: u.multiplier,
          })
          .onConflictDoUpdate({
            target: [slotPortions.mealSlotId, slotPortions.userId],
            set: { multiplier: u.multiplier },
          });
      }
      return recordChange(tx, {
        weekStart: input.weekStart,
        userId: input.userId,
        kind: "fit",
        summary:
          dates.length === 1
            ? `Fitted portions on ${formatDay(dates[0])}`
            : `Fitted portions from ${formatDay(dates[0])}`,
        before: {
          added: [],
          removed: [],
          portions: updates.map((u) => ({
            mealSlotId: u.mealSlotId,
            userId: u.userId,
            multiplier: u.was,
          })),
        },
      });
    });
  }

  const name = new Map(plan.members.map((m) => [m.id, m.name]));
  return {
    changeId,
    changed: updates.length,
    days: fit.days.map(({ date, fit: day }) => ({
      date,
      people: Object.entries(day.people).map(([userId, p]) => ({
        userId,
        name: name.get(userId) ?? "",
        status: p.status,
        misses: p.misses,
        incomplete: p.incomplete,
        estimated: p.estimated,
      })),
    })),
    averages: Object.entries(fit.averages).flatMap(([userId, avg]) =>
      avg ? [{ userId, name: name.get(userId) ?? "", ...avg }] : []
    ),
  };
}

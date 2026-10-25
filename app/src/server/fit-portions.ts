import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";

import { formatDay } from "@/lib/format";

import "server-only";

import type { Db } from "./db/client";
import { slotPortions } from "./db/schema";
import { type FitEntry, fitWeek, type PersonFit } from "./domain/plan-fit";
import { isFoodRecipe } from "./domain/taxonomy";
import { weekDays } from "./domain/week";
import { PlanError } from "./errors";
import type { Macros } from "./mealie/nutrition";
import { getWeekPlan, type PlannedMeal, type WeekPlan } from "./plan";
import { lockWeek, recordChange } from "./plan-changes";
import type { Defer, RecipeFetcher } from "./recipe-cache";

export type FitPortionsResult = {
  /** The change to undo; null when every portion was already where the fit put it. */
  changeId: string | null;
  /** How many portions changed. */
  changed: number;
  /** `planKey` of the plan the fit left; once the page's differs, the summary is stale. */
  planKey: string;
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
 * Sums up what a fit's summary depends on from `today` on: meals, servings,
 * portions, logs, fasting and targets. Any edit to those changes it.
 */
export const planKey = (plan: WeekPlan, today: string): string =>
  createHash("sha1")
    .update(
      JSON.stringify([
        plan.members.map((m) => [m.id, m.targets]),
        plan.days
          .filter((d) => d.date >= today)
          .map((d) => [
            d.date,
            plan.members.map((m) => d.fasting[m.id] ?? false),
            d.meals.map((meal) => [
              meal.id,
              meal.baseServings,
              meal.unplanned,
              // A missing portion and a 0 are the same to the fit.
              plan.members.map((m) => meal.portions[m.id] ?? 0),
              plan.members.map((m) => meal.adherence[m.id]?.status ?? null),
            ]),
          ]),
      ])
    )
    .digest("base64url");

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

  // Recipes may come from Mealie: load them before the lock, so the week's
  // other edits don't wait on it.
  const { recipes } = await getWeekPlan(db, input.weekStart, opts);
  return db.transaction(async (tx) => {
    await lockWeek(tx, input.weekStart);
    // Read under the lock: every edit to the week takes it too, so nothing the
    // fit reads (portions, logs, fasting, servings, meals) changes before it
    // writes.
    const plan = await getWeekPlan(tx, input.weekStart, {
      fetch: opts.fetch,
      recipes,
    });
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
      await tx
        .insert(slotPortions)
        .values(
          updates.map(({ mealSlotId, userId, multiplier }) => ({
            mealSlotId,
            userId,
            multiplier,
          }))
        )
        .onConflictDoUpdate({
          target: [slotPortions.mealSlotId, slotPortions.userId],
          set: {
            multiplier: sql.raw(`excluded.${slotPortions.multiplier.name}`),
          },
        });
      changeId = await recordChange(tx, {
        weekStart: input.weekStart,
        userId: input.userId,
        kind: "fit",
        summary:
          dates.length === 1
            ? `Fitted portions on ${formatDay(dates[0])}`
            : `Fitted portions from ${formatDay(dates[0])}`,
        before: {
          added: [],
          // Quarter steps, so `after` is exactly what the column stores.
          portions: updates.map((u) => ({
            mealSlotId: u.mealSlotId,
            userId: u.userId,
            before: u.was,
            after: u.multiplier,
          })),
        },
      });
    }

    const fitted = new Map(fit.days.map((d) => [d.date, d.fit.portions]));
    const after: WeekPlan = {
      ...plan,
      days: plan.days.map((day) => {
        const portions = fitted.get(day.date);
        return portions
          ? {
              ...day,
              meals: day.meals.map((m) => ({ ...m, portions: portions[m.id] })),
            }
          : day;
      }),
    };

    const name = new Map(plan.members.map((m) => [m.id, m.name]));
    return {
      changeId,
      changed: updates.length,
      planKey: planKey(after, input.today),
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
  });
}

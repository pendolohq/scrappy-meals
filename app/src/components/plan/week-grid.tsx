import { Plus } from "lucide-react";
import Link from "next/link";

import { cx } from "@/lib/cx";
import { dayParts, formatAmount, formatDay, formatPortion } from "@/lib/format";
import { personDayTotals } from "@/server/domain/macros";
import { daySlots } from "@/server/domain/slots";
import { weekStartOf } from "@/server/domain/week";
import type { Member, PlannedMeal, WeekPlan } from "@/server/plan";

import { AddMeal } from "./add-meal";
import { SLOT_ICON } from "./day-card";
import { PlanMeal } from "./plan-meal";

/** A planned meal on the Week grid: read-only, opening the meal page. */
const WeekMeal = ({
  meal,
  members,
  currentUserId,
}: {
  meal: PlannedMeal;
  members: Member[];
  currentUserId: string;
}) => {
  const name = meal.recipe?.name ?? meal.slug;
  const mine = meal.portions[currentUserId] ?? 0;
  const others = members.filter(
    (m) => m.id !== currentUserId && (meal.portions[m.id] ?? 0) > 0
  );
  return (
    <li data-testid="grid-meal">
      <Link
        href={`/week/${weekStartOf(meal.date)}/meals/${meal.id}`}
        className="block rounded-control border border-border/70 bg-card px-2.5 py-2 shadow-card transition hover:border-border-strong"
      >
        <span className="line-clamp-2 font-serif text-sm leading-snug font-semibold">
          {name}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted tabular-nums">
          {mine > 0 ? `You ${formatPortion(mine)}×` : "Not for you"}
          {others.map(
            (m) => ` · ${m.name} ${formatPortion(meal.portions[m.id])}×`
          )}
        </span>
      </Link>
    </li>
  );
};

/**
 * The week on wide screens: a row per day, a column per meal slot, so the
 * same slot lines up down the week. The Plan page fills empty cells with
 * "Add"; the Week page links them to the Plan page and heads each day with
 * the viewer's calories.
 */
export const WeekGrid = ({
  plan,
  today,
  mode,
  currentUserId,
  className,
}: {
  plan: Pick<WeekPlan, "days" | "members" | "snackSlots">;
  today: string;
  className?: string;
} & (
  | { mode: "plan"; currentUserId?: undefined }
  | { mode: "week"; currentUserId: string }
)) => {
  // Snack columns past the household's count show while any day uses them.
  const columns = daySlots(
    plan.snackSlots,
    plan.days.flatMap((d) => d.meals)
  );

  return (
    <table
      aria-label={mode === "plan" ? "Plan for the week" : "The week"}
      className={cx(
        "-mx-2 w-[calc(100%+1rem)] table-fixed border-separate border-spacing-2",
        className
      )}
    >
      <thead>
        <tr>
          <th className="w-34">
            <span className="sr-only">Day</span>
          </th>
          {columns.map(({ slot, snackIndex, label }) => {
            const Icon = SLOT_ICON[slot];
            return (
              <th
                key={`${slot}-${snackIndex}`}
                scope="col"
                className="rounded-control bg-sunken px-2 py-2.5 text-xs font-semibold tracking-wider uppercase"
              >
                <span className="flex items-center justify-center gap-1.5">
                  <Icon
                    className="size-4 shrink-0 text-muted"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  <span className="truncate">{label}</span>
                </span>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {plan.days.map(({ date, meals }) => {
          const isToday = date === today;
          const { day, weekday } = dayParts(date);
          const kcal =
            mode === "week"
              ? personDayTotals(
                  meals.map((m) => ({
                    nutrition: m.recipe?.nutrition ?? null,
                    recipeName: m.recipe?.name ?? m.slug,
                    estimated: m.recipe?.nutritionSource === "estimated",
                    baseServings: m.baseServings,
                    portions: m.portions,
                  })),
                  currentUserId
                ).macros.kcal
              : null;
          return (
            <tr key={date} data-testid="grid-day">
              <th
                scope="row"
                className={cx(
                  "rounded-control px-3 py-2 text-left font-normal",
                  isToday
                    ? "bg-highlight-soft ring-1 ring-highlight/40"
                    : "bg-sunken"
                )}
              >
                <span className="sr-only">{formatDay(date)}</span>
                <span
                  aria-hidden
                  className="flex items-baseline gap-2 font-medium"
                >
                  <span
                    className={cx(
                      "font-serif text-2xl font-semibold tabular-nums",
                      isToday && "text-highlight"
                    )}
                  >
                    {day}
                  </span>
                  <span className="text-xs font-semibold tracking-wider uppercase">
                    {weekday}
                  </span>
                </span>
                {isToday && (
                  <span className="block text-xs font-medium text-highlight">
                    Today
                  </span>
                )}
                {kcal !== null && kcal > 0 && (
                  <span className="block text-xs text-muted tabular-nums">
                    {formatAmount(kcal)} kcal
                  </span>
                )}
              </th>

              {columns.map(({ slot, snackIndex, label, active }) => {
                const inSlot = meals.filter(
                  (m) => m.slot === slot && m.snackIndex === snackIndex
                );
                return (
                  <td
                    key={`${slot}-${snackIndex}`}
                    aria-label={`${label}, ${formatDay(date)}`}
                    className={cx(
                      "space-y-1.5 rounded-control p-1.5 align-top",
                      isToday ? "bg-highlight-soft/50" : "bg-card/60"
                    )}
                  >
                    {inSlot.length > 0 && (
                      <ul className="space-y-1.5">
                        {inSlot.map((meal) =>
                          mode === "plan" ? (
                            <PlanMeal
                              key={meal.id}
                              meal={meal}
                              members={plan.members}
                              compact
                            />
                          ) : (
                            <WeekMeal
                              key={meal.id}
                              meal={meal}
                              members={plan.members}
                              currentUserId={currentUserId}
                            />
                          )
                        )}
                      </ul>
                    )}
                    {!active ? null : mode === "plan" ? (
                      <AddMeal
                        date={date}
                        slot={slot}
                        snackIndex={snackIndex}
                        label={label}
                        text="Add meal"
                        className={cx(
                          "flex w-full items-center gap-1.5 rounded-control px-2.5 text-sm text-muted transition hover:bg-accent-soft hover:text-accent-ink",
                          inSlot.length === 0 ? "min-h-20" : "min-h-9"
                        )}
                      />
                    ) : (
                      inSlot.length === 0 && (
                        <Link
                          href={`/plan/${weekStartOf(date)}#${date}`}
                          aria-label={`Plan ${label.toLowerCase()}, ${formatDay(date)}`}
                          className="flex min-h-20 items-center gap-1.5 rounded-control px-2.5 text-sm text-muted transition hover:bg-accent-soft hover:text-accent-ink"
                        >
                          <Plus className="size-4" aria-hidden />
                          Plan
                        </Link>
                      )
                    )}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};

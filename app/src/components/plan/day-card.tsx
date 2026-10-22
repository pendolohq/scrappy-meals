import { Apple, Moon, Plus, Sun, Sunrise, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { Pill } from "@/components/ui/pill";
import { cx } from "@/lib/cx";
import { dayParts, formatDay } from "@/lib/format";
import { daySlots, type SlotType } from "@/server/domain/slots";
import { weekStartOf } from "@/server/domain/week";
import type { Member, PlannedMeal } from "@/server/plan";

import { MealRow } from "./meal-row";
import { dayTotals, PersonTotals } from "./person-totals";

export const SLOT_ICON: Record<SlotType, LucideIcon> = {
  breakfast: Sunrise,
  lunch: Sun,
  dinner: Moon,
  snack: Apple,
};

/** A big day number beside the weekday and month, like a desk calendar. */
export const DayTitle = ({
  date,
  isToday,
}: {
  date: string;
  isToday: boolean;
}) => {
  const { day, weekday, month } = dayParts(date);
  return (
    <h2 className="flex items-center gap-3">
      <span className="sr-only">{formatDay(date)}</span>
      <span
        aria-hidden
        className={cx(
          "w-12 font-serif text-display font-semibold tabular-nums",
          isToday ? "text-highlight" : "text-foreground"
        )}
      >
        {day}
      </span>
      <span aria-hidden className="leading-tight">
        <span className="block text-xs font-semibold tracking-wider uppercase">
          {weekday}
        </span>
        <span className="block text-xs tracking-wider text-muted uppercase">
          {month}
        </span>
      </span>
    </h2>
  );
};

export const DayCard = ({
  date,
  meals,
  members,
  snackSlots,
  fasting,
  currentUserId,
  today,
}: {
  date: string;
  meals: PlannedMeal[];
  members: Member[];
  snackSlots: number;
  fasting: Record<string, boolean>;
  currentUserId: string;
  /** The viewer's today. */
  today: string;
}) => {
  const isToday = date === today;
  // The week shows the viewer's own numbers; the Plan page has everyone's portions.
  const viewer = members.find((m) => m.id === currentUserId);

  return (
    <section
      id={date}
      aria-label={formatDay(date)}
      className={cx(
        "scroll-mt-20 rounded-card border bg-card p-4 shadow-card sm:p-5",
        isToday
          ? "border-highlight/50 ring-1 ring-highlight/30"
          : "border-border/70"
      )}
    >
      <div className="mb-4 flex items-center justify-between gap-2">
        <DayTitle date={date} isToday={isToday} />
        {isToday && <Pill tone="highlight">Today</Pill>}
      </div>

      {viewer && (
        <div className="mb-4 rounded-control bg-sunken/70 p-3">
          <PersonTotals
            member={viewer}
            totals={dayTotals(meals, viewer.id, "logged")}
            date={date}
            fasting={fasting[viewer.id] ?? false}
            plannedPortions={
              meals.filter((meal) => (meal.portions[viewer.id] ?? 0) > 0).length
            }
          />
        </div>
      )}

      <div className="divide-y divide-border/70">
        {daySlots(snackSlots, meals).map(
          ({ slot, snackIndex, label, active }) => {
            const Icon = SLOT_ICON[slot];
            const inSlot = meals.filter(
              (m) => m.slot === slot && m.snackIndex === snackIndex
            );
            return (
              <fieldset
                key={`${slot}-${snackIndex}`}
                aria-label={label}
                className="min-w-0 py-2 first:pt-0 last:pb-0"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="flex items-center gap-2 text-xs font-semibold tracking-wider text-muted uppercase">
                    <Icon className="size-4" strokeWidth={1.75} aria-hidden />
                    {label}
                  </h3>
                  {/* Meals are added on the Plan page; an empty slot links there, at this day. */}
                  {!active ? (
                    <span className="text-xs text-muted">
                      Turned off in settings
                    </span>
                  ) : (
                    inSlot.length === 0 && (
                      <Link
                        href={`/plan/${weekStartOf(date)}#${date}`}
                        aria-label={`Plan ${label.toLowerCase()}`}
                        className="-mr-2 inline-flex min-h-tap items-center gap-1 rounded-button px-3 text-sm font-medium text-accent-ink transition hover:bg-accent-soft"
                      >
                        <Plus className="size-4" aria-hidden />
                        Plan
                      </Link>
                    )
                  )}
                </div>
                {inSlot.length > 0 && (
                  <ul className="divide-y divide-border/70">
                    {inSlot.map((meal) => (
                      <MealRow
                        key={meal.id}
                        meal={meal}
                        weekStart={weekStartOf(date)}
                        members={members}
                        currentUserId={currentUserId}
                        canLog={date <= today}
                        today={today}
                      />
                    ))}
                  </ul>
                )}
              </fieldset>
            );
          }
        )}
      </div>
    </section>
  );
};

import { Pill } from "@/components/ui/pill";
import { cx } from "@/lib/cx";
import { formatDay } from "@/lib/format";
import { daySlots } from "@/server/domain/slots";
import type { Member, PlannedMeal } from "@/server/plan";

import { AddMeal } from "./add-meal";
import { DayTitle, SLOT_ICON } from "./day-card";
import { DayMacros, dayTotals } from "./person-totals";
import { PlanMeal } from "./plan-meal";

/**
 * One day of the Planner: a column of its slots, each with its meals and an
 * Add tile, and the viewer's totals at the foot.
 */
export const PlanDay = ({
  date,
  meals,
  members,
  snackSlots,
  today,
  fasting,
  currentUserId,
}: {
  date: string;
  meals: PlannedMeal[];
  members: Member[];
  snackSlots: number;
  today: string;
  fasting: Record<string, boolean>;
  currentUserId: string;
}) => {
  const isToday = date === today;
  const viewer = members.find((m) => m.id === currentUserId);
  return (
    <section
      id={date}
      aria-label={formatDay(date)}
      className={cx(
        "flex w-[85%] max-w-80 shrink-0 snap-start flex-col rounded-card border bg-card p-3 shadow-card sm:w-72",
        isToday
          ? "border-highlight/50 ring-1 ring-highlight/30"
          : "border-border/70"
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <DayTitle date={date} isToday={isToday} />
        {isToday && <Pill tone="highlight">Today</Pill>}
      </div>

      <div className="space-y-4">
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
                className="min-w-0 space-y-2"
              >
                <h3 className="flex items-center gap-2 text-xs font-semibold tracking-wider text-muted uppercase">
                  <Icon className="size-4" strokeWidth={1.75} aria-hidden />
                  {label}
                </h3>
                {inSlot.length > 0 && (
                  <ul className="space-y-2">
                    {inSlot.map((meal) => (
                      <PlanMeal
                        key={meal.id}
                        meal={meal}
                        members={members}
                        snackSlots={snackSlots}
                      />
                    ))}
                  </ul>
                )}
                {active ? (
                  <AddMeal
                    date={date}
                    slot={slot}
                    snackIndex={snackIndex}
                    label={label}
                    today={today}
                    className={
                      inSlot.length === 0
                        ? "flex min-h-tap w-full items-center justify-center gap-1 rounded-control border border-dashed border-border-strong text-sm font-medium text-accent-ink transition hover:border-accent hover:bg-accent-soft"
                        : // Filled slots keep a lighter "add another", so a planned day stays short.
                          "-ml-2 inline-flex min-h-tap items-center gap-1 rounded-button px-2 text-sm font-medium text-accent-ink transition hover:bg-accent-soft"
                    }
                  />
                ) : (
                  <p className="text-xs text-muted">Turned off in settings</p>
                )}
              </fieldset>
            );
          }
        )}
      </div>
      {viewer && (
        <div className="mt-4">
          <DayMacros
            member={viewer}
            totals={dayTotals(meals, viewer.id, "planned")}
            fasting={fasting[viewer.id] ?? false}
          />
        </div>
      )}
    </section>
  );
};

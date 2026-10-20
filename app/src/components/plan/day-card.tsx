import { formatDay } from "@/lib/format";
import { personDayTotals } from "@/server/domain/macros";
import {
  type Member,
  type PlannedMeal,
  SLOT_LABEL,
  SLOT_TYPES,
} from "@/server/plan";

import { AddMeal } from "./add-meal";
import { MealRow } from "./meal-row";
import { PersonTotals } from "./person-totals";

export const DayCard = ({
  date,
  meals,
  members,
  fasting,
  currentUserId,
  isToday,
  isPastOrToday,
}: {
  date: string;
  meals: PlannedMeal[];
  members: Member[];
  fasting: Record<string, boolean>;
  currentUserId: string;
  isToday: boolean;
  isPastOrToday: boolean;
}) => {
  const forMacros = meals.map((m) => ({
    nutrition: m.recipe?.nutrition ?? null,
    recipeName: m.recipe?.name ?? m.slug,
    estimated: m.recipe?.nutritionSource === "estimated",
    baseServings: m.baseServings,
    portions: m.portions,
  }));
  const cols = {
    gridTemplateColumns: `repeat(${Math.max(members.length, 1)}, minmax(0, 1fr))`,
  };

  return (
    <section
      id={date}
      aria-label={formatDay(date)}
      className={`rounded-xl border bg-card p-3 ${isToday ? "border-accent" : "border-border"}`}
    >
      <h2 className="mb-3 flex items-center gap-2 font-semibold">
        {formatDay(date)}
        {isToday && (
          <span className="rounded-full bg-accent px-2 text-xs text-accent-foreground">
            Today
          </span>
        )}
      </h2>

      {members.length > 0 && (
        <div
          className="mb-3 grid gap-3 border-b border-border pb-3"
          style={cols}
        >
          {members.map((m) => (
            <PersonTotals
              key={m.id}
              member={m}
              totals={personDayTotals(forMacros, m.id)}
              date={date}
              fasting={fasting[m.id] ?? false}
              isSelf={m.id === currentUserId}
              plannedPortions={
                meals.filter((meal) => (meal.portions[m.id] ?? 0) > 0).length
              }
            />
          ))}
        </div>
      )}

      <div className="space-y-3">
        {SLOT_TYPES.map((slot) => {
          const label = SLOT_LABEL[slot];
          const inSlot = meals.filter((m) => m.slot === slot);
          return (
            <div key={slot}>
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-medium tracking-wide text-muted uppercase">
                  {label}
                </h3>
                <AddMeal date={date} slot={slot} label={label} />
              </div>
              {inSlot.length > 0 && (
                <ul className="divide-y divide-border">
                  {inSlot.map((meal) => (
                    <MealRow
                      key={meal.id}
                      meal={meal}
                      members={members}
                      currentUserId={currentUserId}
                      canLog={isPastOrToday}
                    />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};

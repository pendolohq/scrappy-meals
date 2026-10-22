import { ChevronRight } from "lucide-react";

import { cx } from "@/lib/cx";
import { formatAmount } from "@/lib/format";
import { type PersonDayTotals, personDayTotals } from "@/server/domain/macros";
import type { Member, PlannedMeal } from "@/server/plan";

import { FastingToggle } from "./fasting-toggle";

// At a glance; fibre waits behind a disclosure.
const MACROS = [
  { key: "protein", label: "Protein" },
  { key: "carbs", label: "Carbs" },
  { key: "fat", label: "Fat" },
] as const;

/** One person's totals for a day's planned meals. */
export const dayTotals = (meals: PlannedMeal[], userId: string) =>
  personDayTotals(
    meals.map((m) => ({
      nutrition: m.recipe?.nutrition ?? null,
      recipeName: m.recipe?.name ?? m.slug,
      estimated: m.recipe?.nutritionSource === "estimated",
      baseServings: m.baseServings,
      portions: m.portions,
    })),
    userId
  );

const tone = (total: number, target: number) => {
  const ratio = total / target;
  if (ratio > 1.1) {
    return "bg-danger";
  }
  if (ratio >= 0.9) {
    return "bg-highlight";
  }
  return "bg-muted/60";
};

const Bar = ({
  total,
  target,
  thick = false,
}: {
  total: number;
  target: number;
  thick?: boolean;
}) => {
  const pct = Math.min(100, (total / target) * 100);
  return (
    <div
      className={cx(
        "w-full overflow-hidden rounded-full bg-border",
        thick ? "h-2" : "h-1"
      )}
      aria-hidden
    >
      <div
        className={cx("h-full rounded-full", tone(total, target))}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
};

const NO_TARGETS: Member["targets"] = {
  kcal: null,
  protein: null,
  carbs: null,
  fat: null,
  fibre: null,
};

const Macro = ({
  label,
  total,
  target,
}: {
  label: string;
  total: number;
  target: number | null;
}) => (
  <div className="min-w-0 space-y-1">
    <div className="flex items-baseline justify-between gap-1">
      <dt className="truncate text-muted">{label}</dt>
      <dd className="font-medium whitespace-nowrap">
        {formatAmount(total)}
        {target ? (
          <span className="text-[10px] font-normal text-muted">
            /{formatAmount(target)}
          </span>
        ) : null}
      </dd>
    </div>
    {target ? <Bar total={total} target={target} /> : null}
  </div>
);

/**
 * The viewer's own day: kcal against their target, protein, carbs and fat,
 * fibre on demand, and their fasting toggle. Other members' numbers aren't
 * shown on the week; their targets aren't the viewer's concern.
 */
export const PersonTotals = ({
  member,
  totals,
  date,
  fasting,
  plannedPortions,
}: {
  member: Member;
  totals: PersonDayTotals;
  date: string;
  fasting: boolean;
  plannedPortions: number;
}) => {
  // Targets don't apply on a fasting day; whatever is still eaten is shown plainly.
  const targets = fasting ? NO_TARGETS : member.targets;
  const kcal = totals.macros.kcal;
  return (
    <div
      className="min-w-0 space-y-2.5"
      data-testid={`totals-${member.name}`}
      data-fasting={fasting}
    >
      <div className="flex items-center justify-between gap-3">
        {fasting && totals.mealsEaten === 0 ? (
          <p className="text-sm text-muted">Fasting day: no targets.</p>
        ) : (
          <p className="text-sm tabular-nums">
            <span className="text-lg font-semibold" data-testid="kcal">
              {formatAmount(kcal)}
            </span>
            {targets.kcal ? (
              <span className="text-muted"> / {targets.kcal} kcal</span>
            ) : (
              <span className="text-muted"> kcal</span>
            )}
          </p>
        )}
        <FastingToggle
          date={date}
          fasting={fasting}
          plannedPortions={plannedPortions}
        />
      </div>
      {!(fasting && totals.mealsEaten === 0) && (
        <>
          {targets.kcal ? (
            <Bar total={kcal} target={targets.kcal} thick />
          ) : null}
          <dl className="grid grid-cols-3 gap-x-4 text-xs tabular-nums">
            {MACROS.map(({ key, label }) => (
              <Macro
                key={key}
                label={label}
                total={totals.macros[key]}
                target={targets[key]}
              />
            ))}
          </dl>
          <details className="group text-xs tabular-nums">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-muted hover:text-foreground [&::-webkit-details-marker]:hidden">
              <ChevronRight
                className="size-3.5 transition group-open:rotate-90"
                aria-hidden
              />
              Fibre
            </summary>
            <dl className="mt-1.5 grid grid-cols-3 gap-x-4">
              <Macro
                label="Fibre"
                total={totals.macros.fibre}
                target={targets.fibre}
              />
            </dl>
          </details>
        </>
      )}
      {(totals.incomplete || totals.estimatedRecipes.length > 0) && (
        <div className="flex flex-wrap gap-x-3">
          {totals.incomplete && (
            <span
              className="text-xs text-danger"
              title={`Missing nutrition: ${totals.incompleteRecipes.join(", ")}`}
              aria-label={`Totals incomplete. Missing nutrition: ${totals.incompleteRecipes.join(", ")}`}
            >
              ⚠ incomplete
            </span>
          )}
          {totals.estimatedRecipes.length > 0 && (
            <span
              className="text-xs text-muted"
              title={`Estimated nutrition: ${totals.estimatedRecipes.join(", ")}`}
              aria-label={`Includes estimated nutrition: ${totals.estimatedRecipes.join(", ")}`}
            >
              ≈ estimated
            </span>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * The viewer's day at the foot of a Plan column: kcal and protein, carbs and
 * fat, so the day can be balanced while it's planned. Logging and fasting
 * stay on the Week page.
 */
export const DayMacros = ({
  member,
  totals,
  fasting,
}: {
  member: Member;
  totals: PersonDayTotals;
  fasting: boolean;
}) => {
  const targets = fasting ? NO_TARGETS : member.targets;
  const kcal = totals.macros.kcal;
  return (
    <div
      className="min-w-0 space-y-2 border-t border-border/70 pt-3"
      data-testid="day-macros"
    >
      <p className="flex items-baseline justify-between gap-2 text-sm tabular-nums">
        <span>
          <span className="font-semibold" data-testid="kcal">
            {formatAmount(kcal)}
          </span>
          <span className="text-muted">
            {targets.kcal ? ` / ${targets.kcal} kcal` : " kcal"}
          </span>
        </span>
        {(totals.incomplete || totals.estimatedRecipes.length > 0) && (
          <span
            className={cx(
              "text-xs",
              totals.incomplete ? "text-danger" : "text-muted"
            )}
            title={
              totals.incomplete
                ? `Missing nutrition: ${totals.incompleteRecipes.join(", ")}`
                : `Estimated nutrition: ${totals.estimatedRecipes.join(", ")}`
            }
          >
            {totals.incomplete ? "⚠ incomplete" : "≈ estimated"}
          </span>
        )}
      </p>
      {targets.kcal ? <Bar total={kcal} target={targets.kcal} /> : null}
      <dl className="grid grid-cols-3 gap-x-3 text-xs tabular-nums">
        {MACROS.map(({ key, label }) => (
          <Macro
            key={key}
            label={label}
            total={totals.macros[key]}
            target={targets[key]}
          />
        ))}
      </dl>
    </div>
  );
};

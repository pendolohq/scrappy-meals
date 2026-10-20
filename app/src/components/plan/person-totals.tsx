import { Pill } from "@/components/ui/pill";
import { cx } from "@/lib/cx";
import { formatAmount } from "@/lib/format";
import type { PersonDayTotals } from "@/server/domain/macros";
import type { Member } from "@/server/plan";

import { FastingToggle } from "./fasting-toggle";

const MACROS = [
  { key: "protein", label: "P" },
  { key: "carbs", label: "C" },
  { key: "fat", label: "F" },
  { key: "fibre", label: "Fi" },
] as const;

const tone = (total: number, target: number) => {
  const ratio = total / target;
  if (ratio > 1.1) {
    return "bg-danger";
  }
  if (ratio >= 0.9) {
    return "bg-accent";
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

export const PersonTotals = ({
  member,
  totals,
  date,
  fasting,
  isSelf,
  plannedPortions,
}: {
  member: Member;
  totals: PersonDayTotals;
  date: string;
  fasting: boolean;
  /** Only you can change your own fasting days. */
  isSelf: boolean;
  plannedPortions: number;
}) => {
  // Targets don't apply on a fasting day; whatever is still eaten is shown plainly.
  const targets = fasting ? NO_TARGETS : member.targets;
  const kcal = totals.macros.kcal;
  return (
    <div
      className="@container min-w-0 space-y-2"
      data-testid={`totals-${member.name}`}
      data-fasting={fasting}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="truncate text-sm font-semibold">{member.name}</span>
        {isSelf ? (
          <FastingToggle
            date={date}
            fasting={fasting}
            plannedPortions={plannedPortions}
          />
        ) : (
          fasting && <Pill tone="accent">Fasting</Pill>
        )}
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
      {fasting && totals.mealsEaten === 0 ? (
        <p className="text-xs text-muted">Fasting day: no targets.</p>
      ) : (
        <>
          <div className="text-sm tabular-nums">
            <span className="text-lg font-semibold" data-testid="kcal">
              {formatAmount(kcal)}
            </span>
            {targets.kcal ? (
              <span className="text-muted"> / {targets.kcal} kcal</span>
            ) : (
              <span className="text-muted"> kcal</span>
            )}
          </div>
          {targets.kcal ? (
            <Bar total={kcal} target={targets.kcal} thick />
          ) : null}
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs tabular-nums @[15rem]:grid-cols-4">
            {MACROS.map(({ key, label }) => {
              const target = targets[key];
              return (
                <div key={key} className="min-w-0">
                  <dt className="text-muted">{label}</dt>
                  <dd className="truncate font-medium">
                    {formatAmount(totals.macros[key])}
                    {target ? (
                      <span className="text-[10px] font-normal text-muted">
                        /{formatAmount(target)}
                      </span>
                    ) : null}
                  </dd>
                  {target ? (
                    <Bar total={totals.macros[key]} target={target} />
                  ) : null}
                </div>
              );
            })}
          </dl>
        </>
      )}
    </div>
  );
};

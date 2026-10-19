import type { PersonDayTotals } from "@/server/domain/macros";
import type { Member } from "@/server/plan";
import { formatAmount } from "@/lib/format";

import { FastingToggle } from "./fasting-toggle";

const MACROS = [
  { key: "protein", label: "P" },
  { key: "carbs", label: "C" },
  { key: "fat", label: "F" },
  { key: "fibre", label: "Fi" },
] as const;

const tone = (total: number, target: number) => {
  const ratio = total / target;
  if (ratio > 1.1) return "bg-danger";
  if (ratio >= 0.9) return "bg-accent";
  return "bg-muted";
};

const Bar = ({ total, target }: { total: number; target: number }) => {
  const pct = Math.min(100, (total / target) * 100);
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-border"
      aria-hidden
    >
      <div
        className={`h-full ${tone(total, target)}`}
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
      className="min-w-0 space-y-1.5"
      data-testid={`totals-${member.name}`}
      data-fasting={fasting}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="truncate text-sm font-medium">{member.name}</span>
        {isSelf ? (
          <FastingToggle
            date={date}
            fasting={fasting}
            plannedPortions={plannedPortions}
          />
        ) : (
          fasting && (
            <span className="rounded-full border border-accent px-2 py-0.5 text-xs text-accent">
              Fasting
            </span>
          )
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
      </div>
      {fasting && totals.mealsEaten === 0 ? (
        <p className="text-xs text-muted">Fasting day: no targets.</p>
      ) : (
        <>
          <div className="text-sm tabular-nums">
            <span className="font-semibold" data-testid="kcal">
              {formatAmount(kcal)}
            </span>
            {targets.kcal ? (
              <span className="text-muted"> / {targets.kcal} kcal</span>
            ) : (
              <span className="text-muted"> kcal</span>
            )}
          </div>
          {targets.kcal ? <Bar total={kcal} target={targets.kcal} /> : null}
          <dl className="grid grid-cols-4 gap-1 text-xs tabular-nums">
            {MACROS.map(({ key, label }) => {
              const target = targets[key];
              return (
                <div key={key} className="min-w-0">
                  <dt className="text-muted">{label}</dt>
                  <dd className="truncate">
                    {formatAmount(totals.macros[key])}
                  </dd>
                  {target ? (
                    <dd className="truncate text-[10px] text-muted">
                      of {formatAmount(target)}
                    </dd>
                  ) : null}
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

import { after } from "next/server";

import { Card } from "@/components/ui/card";
import { WeekHeader } from "@/components/week-header";
import { formatDay } from "@/lib/format";
import { getDb } from "@/server/db/client";
import {
  ADHERENCE_STATUSES,
  STATUS_LABEL,
  summariseAdherence,
} from "@/server/domain/adherence";
import { today } from "@/server/domain/week";
import { getWeekPlan, SLOT_LABEL } from "@/server/plan";
import { requireUser } from "@/server/session";

import { canonicalWeek } from "../../week-route";

export default async function AdherencePage({
  params,
}: {
  params: Promise<{ weekStart: string }>;
}) {
  await requireUser();
  const weekStart = canonicalWeek((await params).weekStart, "adherence");

  const plan = await getWeekPlan(getDb(), weekStart, { defer: after });
  const now = today();
  const meals = plan.days.flatMap((d) => d.meals);

  return (
    <div className="space-y-5 pb-8">
      <WeekHeader weekStart={weekStart} page="adherence" title="Adherence" />

      <p className="max-w-prose text-sm text-muted">
        Score: stuck to it counts 1, partly or swapped ½, skipped 0, averaged
        over the meals you logged.
      </p>

      {plan.members.map((m) => {
        const summary = summariseAdherence(
          meals.map((meal) => ({
            date: meal.date,
            portion: meal.portions[m.id] ?? 0,
            status: meal.adherence[m.id]?.status ?? null,
          })),
          now
        );
        const notable = meals.filter((meal) => {
          const s = meal.adherence[m.id]?.status;
          return s && s !== "stuck";
        });
        const logged = ADHERENCE_STATUSES.reduce(
          (n, s) => n + summary.counts[s],
          0
        );

        return (
          <Card
            as="section"
            key={m.id}
            className="space-y-4"
            data-testid={`summary-${m.name}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="flex size-11 items-center justify-center rounded-full bg-highlight-soft font-serif text-lg font-semibold text-highlight"
                >
                  {m.name.slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <h2 className="font-serif text-heading font-semibold">
                    {m.name}
                  </h2>
                  <p className="text-sm text-muted" data-testid="logged">
                    {logged} logged
                    {summary.unlogged > 0
                      ? `, ${summary.unlogged} still to log`
                      : ""}
                  </p>
                </div>
              </div>
              <span
                className="font-serif text-display font-semibold text-accent tabular-nums"
                data-testid="score"
              >
                {summary.score === null
                  ? "–"
                  : `${Math.round(summary.score * 100)}%`}
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {ADHERENCE_STATUSES.map((s) => (
                <div key={s} className="rounded-control bg-sunken px-3 py-2.5">
                  <dt className="text-xs text-muted">
                    {STATUS_LABEL[s].icon} {STATUS_LABEL[s].label}
                  </dt>
                  <dd
                    className="text-xl font-semibold tabular-nums"
                    data-testid={`count-${s}`}
                  >
                    {summary.counts[s]}
                  </dd>
                </div>
              ))}
            </dl>
            {notable.length > 0 && (
              <ul className="divide-y divide-border/70 text-sm">
                {notable.map((meal) => {
                  const log = meal.adherence[m.id]!;
                  return (
                    <li key={meal.id} className="flex gap-3 py-2.5">
                      <span
                        aria-hidden
                        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-sunken text-xs"
                      >
                        {STATUS_LABEL[log.status].icon}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-xs text-muted">
                          {formatDay(meal.date)} · {SLOT_LABEL[meal.slot]}
                        </span>
                        <span className="font-medium">
                          {meal.recipe?.name ?? meal.slug}
                        </span>
                        {log.note ? (
                          <span className="text-muted"> ({log.note})</span>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        );
      })}
    </div>
  );
}

import Link from "next/link";
import { after } from "next/server";

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
    <div className="space-y-4 pb-8">
      <WeekHeader weekStart={weekStart} page="adherence" title="Adherence">
        <Link href={`/week/${weekStart}`} className="text-xs text-accent">
          Back to the plan
        </Link>
      </WeekHeader>

      <p className="text-sm text-muted">
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
          <section
            key={m.id}
            className="rounded-xl border border-border bg-card p-4"
            data-testid={`summary-${m.name}`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="font-semibold">{m.name}</h2>
              <span
                className="text-2xl font-semibold tabular-nums"
                data-testid="score"
              >
                {summary.score === null
                  ? "–"
                  : `${Math.round(summary.score * 100)}%`}
              </span>
            </div>
            <p className="text-sm text-muted" data-testid="logged">
              {logged} logged
              {summary.unlogged > 0 ? `, ${summary.unlogged} still to log` : ""}
            </p>
            <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
              {ADHERENCE_STATUSES.map((s) => (
                <div key={s} className="rounded-lg bg-background p-2">
                  <dt className="text-xs text-muted">
                    {STATUS_LABEL[s].icon} {STATUS_LABEL[s].label}
                  </dt>
                  <dd
                    className="text-lg font-semibold tabular-nums"
                    data-testid={`count-${s}`}
                  >
                    {summary.counts[s]}
                  </dd>
                </div>
              ))}
            </dl>
            {notable.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">
                {notable.map((meal) => {
                  const log = meal.adherence[m.id]!;
                  return (
                    <li key={meal.id} className="flex gap-2">
                      <span aria-hidden>{STATUS_LABEL[log.status].icon}</span>
                      <span className="min-w-0">
                        <span className="text-muted">
                          {formatDay(meal.date)} · {SLOT_LABEL[meal.slot]}:
                        </span>{" "}
                        {meal.recipe?.name ?? meal.slug}
                        {log.note ? (
                          <span className="text-muted"> ({log.note})</span>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

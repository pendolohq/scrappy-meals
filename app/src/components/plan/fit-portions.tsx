"use client";

import { useState, useTransition } from "react";
import { Scale } from "lucide-react";

import { fitPortionsAction } from "@/app/(app)/week/actions";
import { attempt, failureText } from "@/components/plan/attempt";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/input";
import { cx } from "@/lib/cx";
import { formatAmount, formatDay } from "@/lib/format";
import { useOnline } from "@/lib/online";
import { describeMiss } from "@/server/domain/plan-fit";
import { weekDays } from "@/server/domain/week";
import type { FitPortionsResult } from "@/server/fit-portions";

const REST_OF_WEEK = "";

/**
 * Fits the portions already planned to everyone's targets, for one day or
 * the rest of the week, then says which days still miss and each person's
 * average. The Undo is the change log's, shown by the page. `planKey` is the
 * page's plan (see the server's `planKey`): once anything changes it, an undo
 * or anyone's edit, the summary is stale and goes.
 */
export const FitPortions = ({
  weekStart,
  today,
  planKey,
}: {
  weekStart: string;
  today: string;
  planKey: string;
}) => {
  const online = useOnline();
  const [pending, startTransition] = useTransition();
  const [day, setDay] = useState(REST_OF_WEEK);
  const [result, setResult] = useState<FitPortionsResult>();
  const [error, setError] = useState<string>();
  const days = weekDays(weekStart).filter((d) => d >= today);
  if (days.length === 0) {
    return null;
  }

  const fit = () =>
    startTransition(async () => {
      setError(undefined);
      const res = await attempt(() =>
        fitPortionsAction({
          weekStart,
          day: day === REST_OF_WEEK ? undefined : day,
        })
      );
      if (res.error !== undefined) {
        setError(failureText(res));
        return;
      }
      setResult(res);
    });

  const shown = result?.planKey === planKey ? result : undefined;
  // Fasting, empty days and people without targets weren't fitted: nothing to report.
  const fitted = (shown?.days ?? []).flatMap((d) =>
    d.people
      .filter((p) => p.status === "fitted")
      .map((p) => ({ date: d.date, ...p }))
  );
  const misses = fitted
    .filter((p) => p.misses.length > 0 || p.incomplete)
    .map((p) => ({
      key: `${p.date}|${p.userId}`,
      text: `${formatDay(p.date)}, ${p.name}: ${[
        ...p.misses.map(describeMiss),
        ...(p.incomplete
          ? ["some meals lack nutrition, so the totals may be low"]
          : []),
      ].join(", ")}`,
    }));
  const estimated = (shown?.days ?? []).some((d) =>
    d.people.some((p) => p.estimated)
  );

  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label className="sr-only" htmlFor="fit-day">
          Days to fit
        </label>
        <select
          id="fit-day"
          className={cx(inputClass, "w-auto text-sm")}
          value={day}
          disabled={pending}
          onChange={(e) => setDay(e.currentTarget.value)}
        >
          <option value={REST_OF_WEEK}>
            {days.length === 7 ? "The whole week" : "Rest of the week"}
          </option>
          {days.map((d) => (
            <option key={d} value={d}>
              {formatDay(d)}
            </option>
          ))}
        </select>
        <Button
          variant="secondary"
          size="sm"
          disabled={pending || !online}
          onClick={fit}
        >
          <Scale className="size-4" aria-hidden />
          {pending ? "Fitting…" : "Fit portions to targets"}
        </Button>
        {!online && (
          <span className="text-muted">Fitting needs a connection.</span>
        )}
      </div>
      <output className="block space-y-1 text-muted">
        {shown && (
          <>
            <p>
              {shown.changed > 0
                ? `Changed ${shown.changed} portion${shown.changed === 1 ? "" : "s"}. `
                : fitted.length > 0 &&
                  "The portions already fit as well as they can. "}
              {fitted.length === 0
                ? "Nobody was fitted: no one with targets is eating on those days."
                : misses.length === 0 && "Every day lands on target."}
            </p>
            {misses.length > 0 && (
              <ul className="list-disc pl-5">
                {misses.map((m) => (
                  <li key={m.key}>{m.text}</li>
                ))}
              </ul>
            )}
            {shown.averages.length > 0 && (
              <p>
                Average a day:{" "}
                {shown.averages
                  .map(
                    (a) =>
                      `${a.name} ${formatAmount(a.macros.kcal)} kcal, ${formatAmount(a.macros.protein)} g protein`
                  )
                  .join("; ")}
                .
              </p>
            )}
            {estimated && <p>Some meals use estimated nutrition.</p>}
          </>
        )}
      </output>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </div>
  );
};

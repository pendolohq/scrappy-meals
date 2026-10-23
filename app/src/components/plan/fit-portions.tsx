"use client";

import { useState, useTransition } from "react";
import { Scale } from "lucide-react";

import { fitPortionsAction } from "@/app/(app)/week/actions";
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
 * average. The Undo is the change log's, shown by the page; once that change
 * is undone or another replaces it, the summary goes too.
 */
export const FitPortions = ({
  weekStart,
  today,
  latestChangeId,
}: {
  weekStart: string;
  today: string;
  latestChangeId: string | null;
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
      const res = await fitPortionsAction({
        weekStart,
        day: day === REST_OF_WEEK ? undefined : day,
      });
      if (res.error !== undefined) {
        setError(res.error);
        return;
      }
      setResult(res);
    });

  const shown =
    result && (result.changeId === null || result.changeId === latestChangeId)
      ? result
      : undefined;
  const misses = (shown?.days ?? []).flatMap((d) =>
    d.people
      .filter((p) => p.misses.length > 0 || p.incomplete)
      .map((p) => ({
        key: `${d.date}|${p.userId}`,
        text: `${formatDay(d.date)}, ${p.name}: ${[
          ...p.misses.map(describeMiss),
          ...(p.incomplete ? ["some meals lack kcal or protein"] : []),
        ].join(", ")}`,
      }))
  );
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
                ? `Changed ${shown.changed} portion${shown.changed === 1 ? "" : "s"}.`
                : "The portions already fit as well as they can."}{" "}
              {misses.length === 0 && "Every day lands on target."}
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

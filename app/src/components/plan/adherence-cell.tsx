"use client";

import { useOptimistic, useState, useTransition } from "react";

import { setAdherenceAction } from "@/app/(app)/week/actions";
import { type AdherenceStatus, STATUS_LABEL } from "@/server/domain/adherence";

type Log = { status: AdherenceStatus; note: string | null } | undefined;

const BUTTONS: AdherenceStatus[] = ["stuck", "partial", "skipped", "swapped"];

/** Your own one-tap log for a meal (tap the active one again to clear). */
export const AdherenceButtons = ({
  mealId,
  mealName,
  log,
}: {
  mealId: string;
  mealName: string;
  log: Log;
}) => {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [current, setOptimistic] = useOptimistic(
    log,
    (_: Log, next: Log) => next,
  );

  const choose = (status: AdherenceStatus) => {
    let next: Log;
    if (current?.status === status) {
      next = undefined; // tapping the active one clears it
    } else if (status === "swapped") {
      const note = window.prompt(
        `What did you have instead of ${mealName}?`,
        current?.note ?? "",
      );
      if (!note?.trim()) return;
      next = { status, note: note.trim() };
    } else {
      next = { status, note: null };
    }
    startTransition(async () => {
      setError(undefined);
      setOptimistic(next);
      const res = await setAdherenceAction({
        mealId,
        status: next?.status ?? null,
        note: next?.note ?? null,
      });
      if (res.error) setError(res.error);
    });
  };

  return (
    <div className="space-y-1">
      <fieldset
        className="flex min-w-0 justify-center gap-1"
        aria-label={`How did ${mealName} go?`}
      >
        {BUTTONS.map((s) => {
          const active = current?.status === s;
          return (
            <button
              key={s}
              type="button"
              disabled={pending}
              aria-pressed={active}
              aria-label={`${STATUS_LABEL[s].label}: ${mealName}`}
              title={
                s === "swapped" && current?.note
                  ? `Had: ${current.note}`
                  : STATUS_LABEL[s].label
              }
              onClick={() => choose(s)}
              className={`h-7 w-8 rounded-md border text-sm disabled:opacity-60 ${
                active
                  ? "border-accent bg-accent text-white dark:text-stone-900"
                  : "border-border text-muted"
              }`}
            >
              {STATUS_LABEL[s].icon}
            </button>
          );
        })}
      </fieldset>
      {current?.status === "swapped" && current.note && (
        <p className="truncate text-center text-xs text-muted">
          Had: {current.note}
        </p>
      )}
      {error && (
        <p role="alert" className="text-center text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
};

/** Someone else's log, read-only. */
export const AdherenceBadge = ({ log }: { log: Log }) => {
  if (!log) return null;
  const { icon, label } = STATUS_LABEL[log.status];
  return (
    <p
      className="truncate text-center text-xs text-muted"
      data-testid="adherence-badge"
    >
      {icon} {label}
      {log.note ? `: ${log.note}` : ""}
    </p>
  );
};

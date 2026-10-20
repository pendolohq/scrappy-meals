"use client";

import { useOptimistic, useState, useTransition } from "react";

import { setAdherenceAction } from "@/app/(app)/week/actions";
import { pillClass, type PillTone } from "@/components/ui/pill";
import { cx } from "@/lib/cx";
import {
  ADHERENCE_STATUSES,
  type AdherenceStatus,
  STATUS_LABEL,
} from "@/server/domain/adherence";

const TONE: Record<AdherenceStatus, PillTone> = {
  stuck: "highlight",
  partial: "neutral",
  swapped: "neutral",
  skipped: "danger",
};

type Log = { status: AdherenceStatus; note: string | null } | undefined;

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
    (_: Log, next: Log) => next
  );

  const choose = (status: AdherenceStatus) => {
    let next: Log;
    if (current?.status === status) {
      next = undefined; // tapping the active one clears it
    } else if (status === "swapped") {
      const note = window.prompt(
        `What did you have instead of ${mealName}?`,
        current?.note ?? ""
      );
      if (!note?.trim()) {
        return;
      }
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
      if (res.error) {
        setError(res.error);
      }
    });
  };

  return (
    // Four 44px buttons need 11rem; a narrower column gets two rows.
    <div className="@container space-y-1">
      <fieldset
        className="mx-auto grid w-full max-w-52 min-w-0 grid-cols-2 rounded-button border border-border bg-card p-0.5 @[11rem]:grid-cols-4"
        aria-label={`How did ${mealName} go?`}
      >
        {ADHERENCE_STATUSES.map((s) => {
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
              className={cx(
                "h-tap min-w-0 rounded-[3px] text-sm transition disabled:opacity-60",
                active
                  ? "bg-accent font-semibold text-accent-foreground shadow-card"
                  : "text-muted hover:bg-sunken hover:text-foreground"
              )}
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
  if (!log) {
    return null;
  }
  const { icon, label } = STATUS_LABEL[log.status];
  return (
    <p className="text-center">
      <span
        className={cx(pillClass(TONE[log.status]), "max-w-full truncate")}
        data-testid="adherence-badge"
      >
        {icon} {label}
        {log.note ? `: ${log.note}` : ""}
      </span>
    </p>
  );
};

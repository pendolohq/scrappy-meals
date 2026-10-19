"use client";

import { useState, useTransition } from "react";

import { setFastingAction } from "@/app/(app)/week/actions";
import { formatDay } from "@/lib/format";

export const FastingToggle = ({
  date,
  fasting,
  plannedPortions,
}: {
  date: string;
  fasting: boolean;
  /** How many of your portions that day are above 0 (zeroed if you start fasting). */
  plannedPortions: number;
}) => {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  const toggle = () => {
    const next = !fasting;
    if (
      next &&
      plannedPortions > 0 &&
      !window.confirm(
        `Fast on ${formatDay(date)}? Your ${plannedPortions} planned portion${plannedPortions === 1 ? "" : "s"} that day will be set to 0.`
      )
    ) {
      return;
    }
    startTransition(async () => {
      setError(undefined);
      const res = await setFastingAction({ date, fasting: next });
      if (res.error) {
        setError(res.error);
      }
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={fasting}
        className={`rounded-full border px-2 py-0.5 text-xs disabled:opacity-60 ${
          fasting
            ? "border-accent bg-accent text-white dark:text-stone-900"
            : "border-border text-muted"
        }`}
      >
        {fasting ? "Fasting ✓" : "Fast"}
      </button>
      {error && (
        <span role="alert" className="block text-xs text-danger">
          {error}
        </span>
      )}
    </>
  );
};

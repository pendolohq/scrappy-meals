"use client";

import { useState, useTransition } from "react";

import { setFastingAction } from "@/app/(app)/week/actions";
import { pillClass } from "@/components/ui/pill";
import { cx } from "@/lib/cx";
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
      {/* The pill is small; the button around it keeps a 44px tall target. */}
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={fasting}
        className="group -my-2.5 inline-flex min-h-tap items-center disabled:opacity-60"
      >
        <span
          className={cx(
            pillClass(fasting ? "solid" : "neutral"),
            "border transition",
            fasting
              ? "border-transparent"
              : "border-border-strong bg-card group-hover:bg-sunken"
          )}
        >
          {fasting ? "Fasting ✓" : "Fast"}
        </span>
      </button>
      {error && (
        <span role="alert" className="block text-xs text-danger">
          {error}
        </span>
      )}
    </>
  );
};

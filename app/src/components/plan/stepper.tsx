"use client";

import { Minus, Plus } from "lucide-react";

import { cx } from "@/lib/cx";
import { formatPortion } from "@/lib/format";

const btn =
  "flex size-tap items-center justify-center rounded-button border border-border-strong bg-card text-foreground transition hover:bg-sunken disabled:opacity-40";

/** − value + for a portion or a number of servings. */
export const Stepper = ({
  label,
  value,
  onChange,
  min = 0,
  max = 20,
  step = 0.25,
  suffix = "×",
  testId = "portion",
}: {
  label: string;
  value: number;
  /** Called with the value one step down or up. */
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  testId?: string;
}) => (
  <fieldset
    className="flex min-w-0 items-center justify-center gap-1"
    aria-label={label}
  >
    <button
      type="button"
      className={btn}
      aria-label={`Less (${label})`}
      disabled={value <= min}
      onClick={() => onChange(Math.max(min, value - step))}
    >
      <Minus className="size-4" aria-hidden />
    </button>
    <span
      className={cx(
        "min-w-9 text-center text-[0.9375rem] font-semibold tabular-nums",
        value === 0 && "font-normal text-muted"
      )}
      data-testid={testId}
    >
      {formatPortion(value)}
      {suffix}
    </span>
    <button
      type="button"
      className={btn}
      aria-label={`More (${label})`}
      disabled={value >= max}
      onClick={() => onChange(Math.min(max, value + step))}
    >
      <Plus className="size-4" aria-hidden />
    </button>
  </fieldset>
);

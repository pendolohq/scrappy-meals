import type { ComponentProps } from "react";

import { cx } from "@/lib/cx";

export type PillTone = "neutral" | "accent" | "highlight" | "danger" | "solid";

const TONES: Record<PillTone, string> = {
  neutral: "bg-sunken text-muted",
  accent: "bg-accent-soft text-accent-ink",
  highlight: "bg-highlight-soft text-highlight",
  danger: "bg-danger-soft text-danger",
  solid: "bg-accent text-accent-foreground",
};

/** `square` is for a pill that is pressed, like the other buttons. */
export const pillClass = (tone: PillTone = "neutral", square = false) =>
  cx(
    "inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
    square ? "rounded-button" : "rounded-full",
    TONES[tone]
  );

/** A small rounded label: "Today", "Fasting", "Estimated". */
export const Pill = ({
  tone,
  className,
  ...props
}: ComponentProps<"span"> & { tone?: PillTone }) => (
  <span className={cx(pillClass(tone), className)} {...props} />
);

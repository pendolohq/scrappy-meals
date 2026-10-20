import type { ComponentProps, ReactNode } from "react";

import { cx } from "@/lib/cx";

export const inputClass = cx(
  "block min-h-tap w-full rounded-control border border-border-strong bg-card px-3.5 text-base text-foreground",
  "placeholder:text-muted/80 transition",
  "focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-0",
  "aria-invalid:border-danger disabled:opacity-60"
);

export const Input = ({ className, ...props }: ComponentProps<"input">) => (
  <input className={cx(inputClass, className)} {...props} />
);

/**
 * A label around its control, so `getByLabel` and screen readers find it.
 * `hint` sits under the control.
 */
export const Field = ({
  label,
  hint,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) => (
  <label className={cx("block space-y-1.5", className)}>
    <span className="block text-sm font-medium text-muted">{label}</span>
    {children}
    {hint && <span className="block text-xs text-muted">{hint}</span>}
  </label>
);

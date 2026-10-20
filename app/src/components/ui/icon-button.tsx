import type { ComponentProps } from "react";

import { cx } from "@/lib/cx";

export type IconButtonVariant = "plain" | "outline" | "solid";

const VARIANTS: Record<IconButtonVariant, string> = {
  plain: "text-muted hover:bg-sunken hover:text-foreground",
  outline:
    "border border-border bg-card text-foreground shadow-card hover:bg-sunken",
  solid: "bg-accent text-accent-foreground hover:brightness-110",
};

/** The icon button look, for links (`<Link className={iconButtonClass()}>`). */
export const iconButtonClass = (variant: IconButtonVariant = "plain") =>
  cx(
    "inline-flex size-tap shrink-0 items-center justify-center rounded-button transition disabled:opacity-40",
    VARIANTS[variant]
  );

/** A round, 44px icon-only button. `label` becomes its accessible name. */
export const IconButton = ({
  label,
  variant,
  className,
  type = "button",
  children,
  ...props
}: Omit<ComponentProps<"button">, "aria-label"> & {
  label: string;
  variant?: IconButtonVariant;
}) => (
  <button
    type={type}
    aria-label={label}
    className={cx(iconButtonClass(variant), className)}
    {...props}
  >
    {children}
  </button>
);

import type { ComponentProps } from "react";

import { cx } from "@/lib/cx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-foreground shadow-card hover:brightness-110",
  secondary:
    "border border-border-strong bg-card text-foreground hover:bg-sunken",
  ghost: "text-accent hover:bg-accent-soft",
  danger: "text-danger hover:bg-danger-soft",
};

// Even "sm" keeps a 44px tall hit area; only the padding shrinks.
const SIZES: Record<ButtonSize, string> = {
  sm: "min-h-tap px-3 text-sm",
  md: "min-h-tap px-4 text-[0.9375rem]",
  lg: "min-h-12 px-5 text-base",
};

/** The button look, for links that act as buttons (`<Link className={buttonClass()}>`). */
export const buttonClass = ({
  variant = "primary",
  size = "md",
  block = false,
}: { variant?: ButtonVariant; size?: ButtonSize; block?: boolean } = {}) =>
  cx(
    "inline-flex items-center justify-center gap-2 rounded-control font-medium transition select-none",
    "disabled:opacity-55 disabled:shadow-none disabled:hover:brightness-100 aria-disabled:opacity-55",
    VARIANTS[variant],
    SIZES[size],
    block && "w-full"
  );

export const Button = ({
  variant,
  size,
  block,
  className,
  type = "button",
  ...props
}: ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Full width. */
  block?: boolean;
}) => (
  <button
    type={type}
    className={cx(buttonClass({ variant, size, block }), className)}
    {...props}
  />
);

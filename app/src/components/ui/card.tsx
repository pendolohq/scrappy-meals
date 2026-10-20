import type { ComponentProps, ElementType } from "react";

import { cx } from "@/lib/cx";

/** A soft, slightly lighter sheet of paper on the page. */
export const cardClass = (padded = true) =>
  cx(
    "rounded-card border border-border/70 bg-card shadow-card",
    padded && "p-4 sm:p-5"
  );

export const Card = <T extends ElementType = "div">({
  as,
  padded = true,
  className,
  ...props
}: { as?: T; padded?: boolean } & Omit<ComponentProps<T>, "as">) => {
  const Tag: ElementType = as ?? "div";
  return <Tag className={cx(cardClass(padded), className)} {...props} />;
};

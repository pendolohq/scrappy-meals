import type { ReactNode } from "react";

import { cx } from "@/lib/cx";

/** A page's serif title, with an optional line under it and actions on the right. */
export const PageHeader = ({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) => (
  <header className={cx("flex items-end justify-between gap-4", className)}>
    <div className="min-w-0 space-y-1">
      <h1 className="font-serif text-title font-semibold">{title}</h1>
      {description && <p className="text-sm text-muted">{description}</p>}
    </div>
    {actions && <div className="flex shrink-0 gap-1">{actions}</div>}
  </header>
);

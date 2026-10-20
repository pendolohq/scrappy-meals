import type { ReactNode } from "react";

import { cx } from "@/lib/cx";

/**
 * A calm, centred message with an icon: offline, errors, not found.
 * `actions` go under the text.
 */
export const Notice = ({
  icon,
  title,
  children,
  actions,
  className,
}: {
  icon: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) => (
  <div
    className={cx(
      "mx-auto flex max-w-sm flex-col items-center gap-4 text-center",
      className
    )}
  >
    <span
      aria-hidden
      className="flex size-16 items-center justify-center rounded-full bg-highlight-soft text-highlight [&>svg]:size-7"
    >
      {icon}
    </span>
    <div className="space-y-2">
      <h1 className="font-serif text-title font-semibold">{title}</h1>
      {children && <div className="text-muted">{children}</div>}
    </div>
    {actions && (
      <div className="flex w-full flex-col items-stretch gap-2">{actions}</div>
    )}
  </div>
);

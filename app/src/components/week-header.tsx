import Link from "next/link";

import { formatRange } from "@/lib/format";
import { addDays } from "@/server/domain/week";

const nav = "rounded-lg border border-border bg-card px-3 py-1.5 text-sm";

/**
 * Previous/next week arrows around the week's title. The arrows stay on the
 * same page (`page`, e.g. "shopping"; empty for the plan); `children` are the
 * links under the title.
 */
export const WeekHeader = ({
  weekStart,
  page = "",
  title,
  children,
}: {
  weekStart: string;
  page?: string;
  title?: string;
  children: React.ReactNode;
}) => {
  const href = (days: number) =>
    `/week/${addDays(weekStart, days)}${page && `/${page}`}`;
  const range = formatRange(weekStart, addDays(weekStart, 6));
  return (
    <div className="flex items-center justify-between gap-2">
      <Link href={href(-7)} className={nav} aria-label="Previous week">
        ←
      </Link>
      <div className="text-center">
        <h1 className="font-semibold">
          {title ? `${title} · ${range}` : range}
        </h1>
        {children}
      </div>
      <Link href={href(7)} className={nav} aria-label="Next week">
        →
      </Link>
    </div>
  );
};

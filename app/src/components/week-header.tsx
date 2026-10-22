import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { formatRange, formatWeekLabel } from "@/lib/format";
import { addDays, weekStartOf } from "@/server/domain/week";
import { viewerToday } from "@/server/today";

import { iconButtonClass } from "./ui/icon-button";

/**
 * The week's serif title with previous/next arrows. The arrows stay on the
 * same page (`page`, e.g. "shopping"; empty for the plan) of the same section
 * (`base`: "/week", or "/plan" for the Planner). `title` names the
 * page ("Shopping"); without it the title is the week itself ("This week").
 * `children` sit under the date range.
 */
export const WeekHeader = async ({
  weekStart,
  page = "",
  base = "/week",
  title,
  children,
}: {
  weekStart: string;
  page?: string;
  base?: string;
  title?: string;
  children?: React.ReactNode;
}) => {
  const href = (days: number) =>
    `${base}/${addDays(weekStart, days)}${page && `/${page}`}`;
  const label = formatWeekLabel(weekStart, weekStartOf(await viewerToday()));
  const range = formatRange(weekStart, addDays(weekStart, 6));
  return (
    <header className="flex items-end justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <h1 className="font-serif text-title font-semibold sm:text-display">
          {title ?? label}
        </h1>
        <div className="flex flex-wrap items-center gap-x-3 text-sm text-muted">
          <span className="tabular-nums">
            {title ? `${label} · ${range}` : range}
          </span>
          {children}
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <Link
          href={href(-7)}
          className={iconButtonClass("outline")}
          aria-label="Previous week"
        >
          <ChevronLeft className="size-5" aria-hidden />
        </Link>
        <Link
          href={href(7)}
          className={iconButtonClass("outline")}
          aria-label="Next week"
        >
          <ChevronRight className="size-5" aria-hidden />
        </Link>
      </div>
    </header>
  );
};

import { redirect } from "next/navigation";

import { isIsoDate, weekStartOf } from "@/server/domain/week";

/**
 * The `[weekStart]` of a week page, sent to this week when it isn't a date and
 * to its Monday when it isn't one. `page` is the part after the week
 * ("shopping"), empty for the plan itself; `base` is the section the week
 * belongs to ("/plan" for the Plan page).
 */
export function canonicalWeek(
  weekStart: string,
  page = "",
  base = "/week"
): string {
  if (!isIsoDate(weekStart)) {
    redirect(base);
  }
  const monday = weekStartOf(weekStart);
  if (monday !== weekStart) {
    redirect(`${base}/${monday}${page && `/${page}`}`);
  }
  return weekStart;
}

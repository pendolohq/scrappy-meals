import { redirect } from "next/navigation";

import { isIsoDate, weekStartOf } from "@/server/domain/week";

/**
 * The `[weekStart]` of a week page, sent to this week when it isn't a date and
 * to its Monday when it isn't one. `page` is the part after the week
 * ("shopping"), empty for the plan itself.
 */
export function canonicalWeek(weekStart: string, page = ""): string {
  if (!isIsoDate(weekStart)) {
    redirect("/week");
  }
  const monday = weekStartOf(weekStart);
  if (monday !== weekStart) {
    redirect(`/week/${monday}${page && `/${page}`}`);
  }
  return weekStart;
}

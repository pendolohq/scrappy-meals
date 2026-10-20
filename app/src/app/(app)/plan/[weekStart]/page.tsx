import Link from "next/link";
import { after } from "next/server";

import { AutoRefresh } from "@/components/auto-refresh";
import { PlanDay } from "@/components/plan/plan-day";
import { WeekGrid } from "@/components/plan/week-grid";
import { WeekHeader } from "@/components/week-header";
import { getDb } from "@/server/db/client";
import { today } from "@/server/domain/week";
import { getWeekPlan } from "@/server/plan";
import { requireUser } from "@/server/session";

import { canonicalWeek } from "../../week/week-route";

const linkClass =
  "inline-flex min-h-tap items-center font-medium text-accent-ink";

export default async function PlanPage({
  params,
}: {
  params: Promise<{ weekStart: string }>;
}) {
  await requireUser();
  const weekStart = canonicalWeek((await params).weekStart, "", "/plan");
  const plan = await getWeekPlan(getDb(), weekStart, { defer: after });
  const now = today();

  return (
    <div className="space-y-5 pb-8" data-wide>
      <AutoRefresh />
      <WeekHeader weekStart={weekStart} base="/plan" title="Plan">
        <Link href={`/week/${weekStart}`} className={linkClass}>
          See the week
        </Link>
      </WeekHeader>

      {plan.members.length === 0 && (
        <p className="text-sm text-muted">No users yet.</p>
      )}
      {/* Days side by side; on phones each snaps into place with the next one
          peeking in. `relative` keeps the columns' absolutely placed screen-reader
          text clipped here too, or it widens the whole page. */}
      <div className="relative -mx-4 flex snap-x snap-mandatory scroll-px-4 items-start gap-3 overflow-x-auto overscroll-x-contain px-4 pb-2 sm:-mx-6 sm:scroll-px-6 sm:px-6 xl:hidden">
        {plan.days.map((day) => (
          <PlanDay
            key={day.date}
            date={day.date}
            meals={day.meals}
            members={plan.members}
            snackSlots={plan.snackSlots}
            isToday={day.date === now}
          />
        ))}
      </div>
      <WeekGrid
        plan={plan}
        today={now}
        mode="plan"
        className="hidden xl:grid"
      />
    </div>
  );
}

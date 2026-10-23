import Link from "next/link";
import { after } from "next/server";

import { AutoRefresh } from "@/components/auto-refresh";
import { CopyLastWeek } from "@/components/plan/copy-last-week";
import { FitPortions } from "@/components/plan/fit-portions";
import { PlanDay } from "@/components/plan/plan-day";
import { UndoChange } from "@/components/plan/undo-change";
import { WeekGrid } from "@/components/plan/week-grid";
import { WeekHeader } from "@/components/week-header";
import { getDb } from "@/server/db/client";
import { addDays } from "@/server/domain/week";
import { getWeekPlan, hasMeals } from "@/server/plan";
import { recentChange } from "@/server/plan-changes";
import { requireUser } from "@/server/session";
import { viewerToday } from "@/server/today";

import { canonicalWeek } from "../../week/week-route";

const linkClass =
  "inline-flex min-h-tap items-center font-medium text-accent-ink";

export default async function PlanPage({
  params,
}: {
  params: Promise<{ weekStart: string }>;
}) {
  const user = await requireUser();
  const weekStart = canonicalWeek((await params).weekStart, "", "/plan");
  const [plan, lastWeekHasMeals, change] = await Promise.all([
    getWeekPlan(getDb(), weekStart, { defer: after }),
    hasMeals(getDb(), addDays(weekStart, -7)),
    recentChange(getDb(), weekStart),
  ]);
  const now = await viewerToday();

  return (
    <div className="space-y-5 pb-8" data-wide>
      <AutoRefresh />
      <WeekHeader weekStart={weekStart} base="/plan" title="Planner">
        <Link href={`/week/${weekStart}`} className={linkClass}>
          See the week
        </Link>
      </WeekHeader>
      {lastWeekHasMeals && <CopyLastWeek weekStart={weekStart} />}
      {/* Only meals already planned get fitted, and past days stay as they were. */}
      {plan.days.some((d) => d.date >= now && d.meals.length > 0) && (
        <FitPortions
          weekStart={weekStart}
          today={now}
          latestChangeId={change?.id ?? null}
        />
      )}
      {change && (
        <UndoChange
          key={change.id}
          changeId={change.id}
          summary={change.summary}
          byName={change.byName}
        />
      )}

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
            today={now}
            fasting={day.fasting}
            currentUserId={user.id}
          />
        ))}
      </div>
      <WeekGrid
        plan={plan}
        today={now}
        mode="plan"
        currentUserId={user.id}
        className="hidden xl:table"
      />
    </div>
  );
}

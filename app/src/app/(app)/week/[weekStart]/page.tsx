import Link from "next/link";
import { after } from "next/server";

import { AutoRefresh } from "@/components/auto-refresh";
import { DayCard } from "@/components/plan/day-card";
import { DayCarousel } from "@/components/plan/day-carousel";
import { WeekGrid } from "@/components/plan/week-grid";
import { WeekHeader } from "@/components/week-header";
import { getDb } from "@/server/db/client";
import { weekStartOf } from "@/server/domain/week";
import { getWeekPlan } from "@/server/plan";
import { requireUser } from "@/server/session";
import { viewerToday } from "@/server/today";

import { canonicalWeek } from "../week-route";

const linkClass =
  "inline-flex min-h-tap items-center font-medium text-accent-ink";

export default async function WeekPage({
  params,
}: {
  params: Promise<{ weekStart: string }>;
}) {
  const user = await requireUser();
  const weekStart = canonicalWeek((await params).weekStart);
  const plan = await getWeekPlan(getDb(), weekStart, { defer: after });
  const now = await viewerToday();
  const dates = plan.days.map((day) => day.date);

  return (
    <div className="space-y-5 pb-8" data-wide>
      <AutoRefresh />
      <WeekHeader weekStart={weekStart}>
        {weekStartOf(now) !== weekStart && (
          <Link href="/week" className={linkClass}>
            Back to this week
          </Link>
        )}
        <Link href={`/plan/${weekStart}`} className={linkClass}>
          Plan this week
        </Link>
      </WeekHeader>

      {plan.members.length === 0 && (
        <p className="text-sm text-muted">No users yet.</p>
      )}
      {/* Opens on today in this week; any other week opens on its Monday. */}
      <DayCarousel
        key={weekStart}
        dates={dates}
        today={now}
        initial={dates.includes(now) ? now : weekStart}
        className="xl:hidden"
      >
        {plan.days.map((day) => (
          <DayCard
            key={day.date}
            date={day.date}
            meals={day.meals}
            members={plan.members}
            snackSlots={plan.snackSlots}
            fasting={day.fasting}
            currentUserId={user.id}
            isToday={day.date === now}
            isPastOrToday={day.date <= now}
            today={now}
          />
        ))}
      </DayCarousel>
      <WeekGrid
        plan={plan}
        today={now}
        mode="week"
        currentUserId={user.id}
        className="hidden xl:table"
      />
    </div>
  );
}

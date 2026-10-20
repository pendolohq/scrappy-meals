import Link from "next/link";
import { after } from "next/server";

import { AutoRefresh } from "@/components/auto-refresh";
import { DayCard } from "@/components/plan/day-card";
import { WeekHeader } from "@/components/week-header";
import { getDb } from "@/server/db/client";
import { today, weekStartOf } from "@/server/domain/week";
import { getWeekPlan } from "@/server/plan";
import { requireUser } from "@/server/session";

import { canonicalWeek } from "../week-route";

export default async function WeekPage({
  params,
}: {
  params: Promise<{ weekStart: string }>;
}) {
  const user = await requireUser();
  const weekStart = canonicalWeek((await params).weekStart);
  const plan = await getWeekPlan(getDb(), weekStart, { defer: after });
  const now = today();

  return (
    <div className="space-y-4 pb-8">
      <AutoRefresh />
      <WeekHeader weekStart={weekStart}>
        <Link
          href={`/week/${weekStart}/shopping`}
          className="mr-3 text-xs text-accent"
        >
          Shopping
        </Link>
        <Link
          href={`/week/${weekStart}/adherence`}
          className="mr-3 text-xs text-accent"
        >
          Adherence
        </Link>
        {weekStartOf(now) !== weekStart && (
          <Link href="/week" className="text-xs text-accent">
            Back to this week
          </Link>
        )}
      </WeekHeader>

      {plan.members.length === 0 && (
        <p className="text-sm text-muted">No users yet.</p>
      )}
      {plan.days.map((day) => (
        <DayCard
          key={day.date}
          date={day.date}
          meals={day.meals}
          members={plan.members}
          fasting={day.fasting}
          currentUserId={user.id}
          isToday={day.date === now}
          isPastOrToday={day.date <= now}
        />
      ))}
    </div>
  );
}

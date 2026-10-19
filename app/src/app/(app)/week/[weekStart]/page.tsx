import Link from "next/link";
import { redirect } from "next/navigation";

import { AutoRefresh } from "@/components/auto-refresh";
import { DayCard } from "@/components/plan/day-card";
import { formatRange } from "@/lib/format";
import { getDb } from "@/server/db/client";
import { addDays, isIsoDate, today, weekStartOf } from "@/server/domain/week";
import { getWeekPlan } from "@/server/plan";

export const dynamic = "force-dynamic";

export default async function WeekPage({ params }: { params: Promise<{ weekStart: string }> }) {
  const { weekStart } = await params;
  if (!isIsoDate(weekStart)) redirect("/week");
  if (weekStartOf(weekStart) !== weekStart) redirect(`/week/${weekStartOf(weekStart)}`);

  const plan = await getWeekPlan(getDb(), weekStart);
  const now = today();
  const nav = "rounded-lg border border-border bg-card px-3 py-1.5 text-sm";

  return (
    <div className="space-y-4 pb-8">
      <AutoRefresh />
      <div className="flex items-center justify-between gap-2">
        <Link href={`/week/${addDays(weekStart, -7)}`} className={nav} aria-label="Previous week">
          ←
        </Link>
        <div className="text-center">
          <h1 className="font-semibold">{formatRange(weekStart, addDays(weekStart, 6))}</h1>
          {weekStartOf(now) !== weekStart && (
            <Link href="/week" className="text-xs text-accent">
              Back to this week
            </Link>
          )}
        </div>
        <Link href={`/week/${addDays(weekStart, 7)}`} className={nav} aria-label="Next week">
          →
        </Link>
      </div>

      {plan.members.length === 0 && <p className="text-sm text-muted">No users yet.</p>}
      {plan.days.map((day) => (
        <DayCard key={day.date} date={day.date} meals={day.meals} members={plan.members} isToday={day.date === now} />
      ))}
    </div>
  );
}

import { redirect } from "next/navigation";

import { getDb } from "@/server/db/client";
import { weekStartOf, weekToPlan } from "@/server/domain/week";
import { hasMeals } from "@/server/plan";
import { requireUser } from "@/server/session";
import { viewerToday } from "@/server/today";

export const dynamic = "force-dynamic";

export default async function PlanNextWeek() {
  await requireUser();
  const now = await viewerToday();
  redirect(
    `/plan/${weekToPlan(now, await hasMeals(getDb(), weekStartOf(now)))}`
  );
}

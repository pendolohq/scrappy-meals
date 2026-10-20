import { redirect } from "next/navigation";

import { getDb } from "@/server/db/client";
import { today, weekStartOf, weekToPlan } from "@/server/domain/week";
import { hasMeals } from "@/server/plan";
import { requireUser } from "@/server/session";

export const dynamic = "force-dynamic";

export default async function PlanNextWeek() {
  await requireUser();
  const now = today();
  redirect(
    `/plan/${weekToPlan(now, await hasMeals(getDb(), weekStartOf(now)))}`
  );
}

import { redirect } from "next/navigation";

import { weekStartOf } from "@/server/domain/week";
import { requireUser } from "@/server/session";
import { viewerToday } from "@/server/today";

export const dynamic = "force-dynamic";

export default async function CurrentWeek() {
  await requireUser();
  redirect(`/week/${weekStartOf(await viewerToday())}`);
}

import { redirect } from "next/navigation";

import { today, weekStartOf } from "@/server/domain/week";

export const dynamic = "force-dynamic";

export default function CurrentWeek() {
  redirect(`/week/${weekStartOf(today())}`);
}

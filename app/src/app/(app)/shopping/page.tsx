import { redirect } from "next/navigation";

import { today, weekStartOf } from "@/server/domain/week";

export const dynamic = "force-dynamic";

// The installed app's "Shopping list" shortcut: a fixed URL for this week's list.
export default function CurrentShopping() {
  redirect(`/week/${weekStartOf(today())}/shopping`);
}

import { cookies } from "next/headers";

import { TIME_ZONE_COOKIE } from "@/lib/time-zone";

import "server-only";

import { today } from "./domain/week";

/**
 * Today's date for whoever is asking, in their device's time zone. The zone
 * is the browser's word for it: setting a far-east one only lets someone log
 * their own meals up to a day early.
 */
export async function viewerToday(now: Date = new Date()): Promise<string> {
  return today(now, (await cookies()).get(TIME_ZONE_COOKIE)?.value);
}

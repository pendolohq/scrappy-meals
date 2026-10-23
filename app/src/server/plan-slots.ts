import { and, eq, sql } from "drizzle-orm";

import "server-only";

import type { Db } from "./db/client";
import { mealSlots } from "./db/schema";
import type { SlotType } from "./domain/slots";

/** The position after the last meal already in a day's slot, so a new one goes at the end. */
export async function nextPosition(
  tx: Pick<Db, "select">,
  date: string,
  slot: SlotType,
  snackIndex: number
): Promise<number> {
  const [{ next }] = await tx
    .select({
      next: sql<number>`coalesce(max(${mealSlots.position}) + 1, 0)::int`,
    })
    .from(mealSlots)
    .where(
      and(
        eq(mealSlots.date, date),
        eq(mealSlots.slot, slot),
        eq(mealSlots.snackIndex, snackIndex)
      )
    );
  return next;
}

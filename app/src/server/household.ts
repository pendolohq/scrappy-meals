import { eq } from "drizzle-orm";

import "server-only";

import type { Db } from "./db/client";
import { householdSettings } from "./db/schema";
import { DEFAULT_SNACK_SLOTS, MAX_SNACK_SLOTS } from "./domain/slots";
import { UserFacingError } from "./errors";

export class HouseholdError extends UserFacingError {
  name = "HouseholdError";
}

export async function getSnackSlots(db: Db): Promise<number> {
  const [row] = await db
    .select({ snackSlots: householdSettings.snackSlots })
    .from(householdSettings)
    .where(eq(householdSettings.id, 1));
  return row?.snackSlots ?? DEFAULT_SNACK_SLOTS;
}

/** Meals already planned in a slot that is turned off stay where they are. */
export async function setSnackSlots(db: Db, count: number): Promise<void> {
  if (!Number.isInteger(count) || count < 0 || count > MAX_SNACK_SLOTS) {
    throw new HouseholdError(
      `Snacks a day must be a whole number from 0 to ${MAX_SNACK_SLOTS}`
    );
  }
  await db
    .insert(householdSettings)
    .values({ id: 1, snackSlots: count })
    .onConflictDoUpdate({
      target: householdSettings.id,
      set: { snackSlots: count, updatedAt: new Date() },
    });
}

import { and, asc, eq } from "drizzle-orm";

import type { ShopItemView } from "@/lib/shop-list";

import "server-only";

import type { Db } from "./db/client";
import { shoppingExtras, shoppingHidden, shoppingTicks } from "./db/schema";
import { buildShopItems } from "./domain/shop-items";
import {
  coverMax,
  type TickedAmount,
  type WeekIngredients,
} from "./domain/shopping";
import { UserFacingError } from "./errors";
import type { Defer, RecipeFetcher } from "./recipe-cache";
import { weekShoppingList } from "./shopping";

/**
 * The week's checklist: the plan's lines (from the cached recipes, so Mealie
 * being down doesn't matter) with the household's ticks, hidden lines and
 * hand-added extras applied.
 */
export async function weekShopList(
  db: Db,
  weekStart: string,
  opts: { fetch?: RecipeFetcher; defer?: Defer } = {}
): Promise<{ plan: WeekIngredients; items: ShopItemView[] }> {
  const [plan, ticks, hidden, extras] = await Promise.all([
    weekShoppingList(db, weekStart, opts),
    db
      .select({
        lineKey: shoppingTicks.lineKey,
        amounts: shoppingTicks.amounts,
      })
      .from(shoppingTicks)
      .where(eq(shoppingTicks.weekStart, weekStart)),
    db
      .select({
        lineKey: shoppingHidden.lineKey,
        amounts: shoppingHidden.amounts,
      })
      .from(shoppingHidden)
      .where(eq(shoppingHidden.weekStart, weekStart)),
    db
      .select({
        id: shoppingExtras.id,
        text: shoppingExtras.text,
        checked: shoppingExtras.checked,
      })
      .from(shoppingExtras)
      .where(eq(shoppingExtras.weekStart, weekStart))
      .orderBy(asc(shoppingExtras.createdAt), asc(shoppingExtras.id)),
  ]);
  return {
    plan,
    items: buildShopItems(plan, {
      ticks,
      hidden,
      extras,
    }),
  };
}

/**
 * Sets (not toggles) a plan line's tick, so replaying a queued change is
 * harmless. A tick keeps the larger amounts it was ever made at, so one
 * replayed from a device that loaded the page earlier can't undo a newer one.
 */
export async function checkShopLine(
  db: Db,
  input: {
    weekStart: string;
    userId: string;
    lineKey: string;
    checked: boolean;
    amounts: TickedAmount[];
  }
): Promise<void> {
  const { weekStart, lineKey } = input;
  if (!input.checked) {
    await db
      .delete(shoppingTicks)
      .where(
        and(
          eq(shoppingTicks.weekStart, weekStart),
          eq(shoppingTicks.lineKey, lineKey)
        )
      );
    return;
  }
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ amounts: shoppingTicks.amounts })
      .from(shoppingTicks)
      .where(
        and(
          eq(shoppingTicks.weekStart, weekStart),
          eq(shoppingTicks.lineKey, lineKey)
        )
      )
      .for("update");
    const row = {
      weekStart,
      lineKey,
      amounts: coverMax(existing?.amounts ?? [], input.amounts),
      checkedAt: new Date(),
      checkedBy: input.userId,
    };
    await tx
      .insert(shoppingTicks)
      .values(row)
      .onConflictDoUpdate({
        target: [shoppingTicks.weekStart, shoppingTicks.lineKey],
        set: row,
      });
  });
}

/**
 * Removes a plan line for the amounts it shows; it comes back when the plan
 * needs more. Works for a line that already left the plan.
 */
export async function hideShopLine(
  db: Db,
  input: {
    weekStart: string;
    userId: string;
    lineKey: string;
    amounts: TickedAmount[];
  }
): Promise<void> {
  const { weekStart, lineKey } = input;
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ amounts: shoppingHidden.amounts })
      .from(shoppingHidden)
      .where(
        and(
          eq(shoppingHidden.weekStart, weekStart),
          eq(shoppingHidden.lineKey, lineKey)
        )
      )
      .for("update");
    const row = {
      weekStart,
      lineKey,
      amounts: coverMax(existing?.amounts ?? [], input.amounts),
      hiddenAt: new Date(),
      hiddenBy: input.userId,
    };
    await tx
      .insert(shoppingHidden)
      .values(row)
      .onConflictDoUpdate({
        target: [shoppingHidden.weekStart, shoppingHidden.lineKey],
        set: row,
      });
  });
}

/** The id comes from the browser, so a replayed add finds its row and does nothing. */
export async function addShopExtra(
  db: Db,
  input: { weekStart: string; userId: string; id: string; text: string }
): Promise<void> {
  const added = await db
    .insert(shoppingExtras)
    .values({
      id: input.id,
      weekStart: input.weekStart,
      text: input.text,
      createdBy: input.userId,
    })
    .onConflictDoNothing()
    .returning({ id: shoppingExtras.id });
  if (added.length > 0) {
    return;
  }
  const [row] = await db
    .select({ weekStart: shoppingExtras.weekStart })
    .from(shoppingExtras)
    .where(eq(shoppingExtras.id, input.id));
  if (row?.weekStart !== input.weekStart) {
    throw new UserFacingError("That item can't be added to this week.");
  }
}

/** Sets (not toggles) the tick. The extra must belong to this week's list. */
export async function checkShopExtra(
  db: Db,
  input: { weekStart: string; id: string; checked: boolean }
): Promise<void> {
  const rows = await db
    .update(shoppingExtras)
    .set({ checked: input.checked })
    .where(
      and(
        eq(shoppingExtras.id, input.id),
        eq(shoppingExtras.weekStart, input.weekStart)
      )
    )
    .returning({ id: shoppingExtras.id });
  if (rows.length === 0) {
    throw new UserFacingError("That item is no longer on the list.");
  }
}

/** An extra that is already gone, or on another week, counts as removed. */
export async function removeShopExtra(
  db: Db,
  input: { weekStart: string; id: string }
): Promise<void> {
  await db
    .delete(shoppingExtras)
    .where(
      and(
        eq(shoppingExtras.id, input.id),
        eq(shoppingExtras.weekStart, input.weekStart)
      )
    );
}

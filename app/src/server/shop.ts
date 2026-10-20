import "server-only";

import type { Db } from "./db/client";
import { UserFacingError } from "./errors";
import { type MealieClient, MealieError } from "./mealie/client";
import {
  addShoppingItems,
  deleteShoppingItems,
  getShoppingItem,
  getShoppingListItems,
  setShoppingItemChecked,
  type ShoppingItem,
  type StoredShoppingItem,
} from "./mealie/shopping";
import { lastPush, shoppingListName } from "./shopping";

type Opts = { client?: MealieClient };

export type ShopList = {
  listId: string;
  listName: string;
  items: ShoppingItem[];
};

/**
 * The Mealie list this week was pushed to, with its current items, ticks and
 * hand-added lines included. Null before the first push, or when the list was
 * deleted in Mealie.
 */
export async function weekShopList(
  db: Db,
  weekStart: string,
  opts: Opts = {}
): Promise<ShopList | null> {
  const pushed = await lastPush(db, weekStart);
  if (!pushed) {
    return null;
  }
  try {
    const items = await getShoppingListItems(pushed.mealieListId, {
      client: opts.client,
    });
    return {
      listId: pushed.mealieListId,
      listName: shoppingListName(weekStart),
      items,
    };
  } catch (err) {
    if (err instanceof MealieError && err.notFound) {
      return null;
    }
    throw err;
  }
}

async function pushedListId(db: Db, weekStart: string): Promise<string> {
  const pushed = await lastPush(db, weekStart);
  if (!pushed) {
    throw new UserFacingError("Send this week's list to Mealie first.");
  }
  return pushed.mealieListId;
}

/**
 * Item ids come from the browser, so every change first checks that the item
 * is on this week's list; otherwise any Mealie item could be edited by id.
 * Null when the item no longer exists.
 */
async function itemOnWeekList(
  db: Db,
  weekStart: string,
  itemId: string,
  opts: Opts
): Promise<StoredShoppingItem | null> {
  const listId = await pushedListId(db, weekStart);
  let item: StoredShoppingItem;
  try {
    item = await getShoppingItem(itemId, { client: opts.client });
  } catch (err) {
    if (err instanceof MealieError && err.notFound) {
      return null;
    }
    throw err;
  }
  if (item.shoppingListId !== listId) {
    throw new UserFacingError("That item isn't on this week's list.");
  }
  return item;
}

/** Sets (not toggles) the tick, so replaying a queued change is harmless. */
export async function checkShopItem(
  db: Db,
  weekStart: string,
  itemId: string,
  checked: boolean,
  opts: Opts = {}
): Promise<void> {
  const item = await itemOnWeekList(db, weekStart, itemId, opts);
  if (!item) {
    throw new UserFacingError("That item is no longer on the list.");
  }
  if (item.checked !== checked) {
    await setShoppingItemChecked(item, checked, { client: opts.client });
  }
}

/**
 * Adds a free-text line to this week's list. It isn't recorded as the
 * planner's, so sending the week again keeps it.
 */
export async function addShopItem(
  db: Db,
  weekStart: string,
  note: string,
  opts: Opts = {}
): Promise<ShoppingItem> {
  const listId = await pushedListId(db, weekStart);
  const { created, updated } = await addShoppingItems(
    listId,
    [{ quantity: 0, note }],
    { client: opts.client }
  );
  const item = created[0] ?? updated[0];
  if (!item) {
    throw new Error("Mealie returned no item");
  }
  return item;
}

/** An item that is already gone counts as removed: a replayed removal is harmless. */
export async function removeShopItem(
  db: Db,
  weekStart: string,
  itemId: string,
  opts: Opts = {}
): Promise<void> {
  if (await itemOnWeekList(db, weekStart, itemId, opts)) {
    await deleteShoppingItems([itemId], { client: opts.client });
  }
}

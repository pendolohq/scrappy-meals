import { eq } from "drizzle-orm";

import "server-only";

import type { Db } from "./db/client";
import { shoppingPushes } from "./db/schema";
import { buildShoppingList, type ShoppingList } from "./domain/shopping";
import { UserFacingError } from "./errors";
import { type MealieClient, MealieError } from "./mealie/client";
import { getRecipe } from "./mealie/recipes";
import {
  addShoppingItems,
  createShoppingList,
  deleteShoppingItems,
  findShoppingListByName,
  getShoppingItem,
  getShoppingListItems,
  type NewShoppingItem,
  setShoppingItemChecked,
  type ShoppingItem,
} from "./mealie/shopping";
import { getWeekPlan } from "./plan";
import { loadRecipes, type RecipeFetcher } from "./recipe-cache";

type Opts = { client?: MealieClient; fetch?: RecipeFetcher };

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "Scrappy Meals · week of 19 Oct 2026" */
export function shoppingListName(weekStart: string): string {
  const [y, m, d] = weekStart.split("-").map(Number);
  return `Scrappy Meals · week of ${d} ${MONTHS[m - 1]} ${y}`;
}

function fetcher(opts: Opts): RecipeFetcher | undefined {
  return (
    opts.fetch ??
    (opts.client
      ? (slug) => getRecipe(slug, { client: opts.client })
      : undefined)
  );
}

export async function weekShoppingList(
  db: Db,
  weekStart: string,
  opts: Opts = {}
): Promise<ShoppingList> {
  const fetch = fetcher(opts);
  const plan = await getWeekPlan(db, weekStart, { fetch });
  const meals = plan.days.flatMap((d) => d.meals);
  const recipes = await loadRecipes(
    db,
    meals.map((m) => m.slug),
    { fetch }
  );
  return buildShoppingList(
    meals.map((m) => {
      const r = recipes.get(m.slug);
      return {
        slug: m.slug,
        baseServings: m.baseServings,
        portions: m.portions,
        recipe: r
          ? {
              id: r.mealieId,
              name: r.name,
              servings: r.servings,
              ingredients: r.ingredients,
            }
          : null,
      };
    })
  );
}

export type PushResult = {
  listId: string;
  listName: string;
  added: number;
  replaced: number;
};

/**
 * Writes the week's list to its own Mealie shopping list. Pushing again
 * replaces the items the planner added last time (ticked or not); anything
 * added by hand in Mealie is left alone.
 */
export async function pushShoppingList(
  db: Db,
  weekStart: string,
  opts: Opts = {}
): Promise<PushResult> {
  const list = await weekShoppingList(db, weekStart, opts);
  const name = shoppingListName(weekStart);
  const mealie = { client: opts.client };

  const [previous] = await db
    .select()
    .from(shoppingPushes)
    .where(eq(shoppingPushes.weekStart, weekStart));
  let listId: string | null = null;
  let replaced = 0;

  if (previous) {
    try {
      const current = new Set(
        (await getShoppingListItems(previous.mealieListId, mealie)).map(
          (i) => i.id
        )
      );
      listId = previous.mealieListId;
      const stale = previous.mealieItemIds.filter((id) => current.has(id));
      await deleteShoppingItems(stale, mealie);
      replaced = stale.length;
    } catch (err) {
      // The list was deleted in Mealie: start a new one.
      if (!(err instanceof MealieError && err.notFound)) {
        throw err;
      }
    }
  }
  listId ??=
    (await findShoppingListByName(name, mealie))?.id ??
    (await createShoppingList(name, mealie)).id;

  const items: NewShoppingItem[] = [
    ...list.lines.map((l) => ({
      quantity: l.quantity ?? 0,
      foodId: l.foodId,
      unitId: l.unitId,
      recipeIds: l.recipes.map((r) => r.id),
    })),
    ...list.freeText.map((f) => ({
      quantity: 0,
      note: `${f.text}${f.times > 1 ? ` (×${f.times})` : ""} · ${f.recipeName}`,
      recipeIds: [f.recipeId],
    })),
  ];
  const { created } = await addShoppingItems(listId, items, mealie);

  const row = {
    weekStart,
    mealieListId: listId,
    mealieItemIds: created.map((i) => i.id),
    pushedAt: new Date(),
  };
  await db
    .insert(shoppingPushes)
    .values(row)
    .onConflictDoUpdate({ target: shoppingPushes.weekStart, set: row });

  return { listId, listName: name, added: created.length, replaced };
}

export async function lastPush(db: Db, weekStart: string) {
  const [row] = await db
    .select()
    .from(shoppingPushes)
    .where(eq(shoppingPushes.weekStart, weekStart));
  return row ?? null;
}

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
 */
async function itemOnWeekList(
  db: Db,
  weekStart: string,
  itemId: string,
  opts: Opts
): Promise<ShoppingItem> {
  const listId = await pushedListId(db, weekStart);
  let item: ShoppingItem;
  try {
    item = await getShoppingItem(itemId, { client: opts.client });
  } catch (err) {
    if (err instanceof MealieError && err.notFound) {
      throw new UserFacingError("That item is no longer on the list.");
    }
    throw err;
  }
  if (item.listId !== listId) {
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
): Promise<ShoppingItem> {
  const item = await itemOnWeekList(db, weekStart, itemId, opts);
  if (item.checked === checked) {
    return item;
  }
  return setShoppingItemChecked(itemId, checked, { client: opts.client });
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

export async function removeShopItem(
  db: Db,
  weekStart: string,
  itemId: string,
  opts: Opts = {}
): Promise<void> {
  await itemOnWeekList(db, weekStart, itemId, opts);
  await deleteShoppingItems([itemId], { client: opts.client });
}

import "server-only";

import { type MealieClient, mealie, unwrap } from "./client";
import type { components } from "./schema";

type MealieItemCreate = components["schemas"]["ShoppingListItemCreate"];
type MealieItemOut = components["schemas"]["ShoppingListItemOut-Output"];
type MealieItemUpdate = components["schemas"]["ShoppingListItemUpdate"];

// Mealie merges and labels every line of a week's list in one request; give it
// time rather than give up halfway with the old items already deleted.
const BULK_TIMEOUT_MS = 30_000;

export type ShoppingItem = {
  id: string;
  listId: string;
  quantity: number;
  foodId: string | null;
  unitId: string | null;
  note: string;
  display: string;
  checked: boolean;
  /** Mealie's label for the item (or its food), used to group by aisle. */
  label: string | null;
  position: number;
};

/** One line to add. Without foodId the line is free text (note) and Mealie won't merge it. */
export type NewShoppingItem = {
  quantity: number;
  foodId?: string | null;
  unitId?: string | null;
  note?: string;
  /** Recipes this line came from, so Mealie can show them on the item. */
  recipeIds?: string[];
};

export async function findShoppingListByName(
  name: string,
  opts: { client?: MealieClient } = {}
): Promise<string | null> {
  const client = opts.client ?? mealie();
  const page = unwrap(
    await client.GET("/api/households/shopping/lists", {
      params: {
        query: {
          queryFilter: `name = "${name.replace(/["\\]/g, "\\$&")}"`,
          perPage: 1,
        },
      },
    })
  );
  const list = page.items[0];
  return list?.id ?? null;
}

export async function createShoppingList(
  name: string,
  opts: { client?: MealieClient } = {}
): Promise<string> {
  const client = opts.client ?? mealie();
  const list = unwrap(
    await client.POST("/api/households/shopping/lists", { body: { name } })
  );
  return list.id;
}

export async function getShoppingListItems(
  listId: string,
  opts: { client?: MealieClient } = {}
): Promise<ShoppingItem[]> {
  const client = opts.client ?? mealie();
  const list = unwrap(
    await client.GET("/api/households/shopping/lists/{item_id}", {
      params: { path: { item_id: listId } },
    })
  );
  return (list.listItems ?? []).map(toItem);
}

/**
 * Adds items in one request. Mealie merges an item into an existing unchecked
 * one with the same food and unit, so a returned id may be in `updated`
 * rather than `created`.
 */
export async function addShoppingItems(
  listId: string,
  items: NewShoppingItem[],
  opts: { client?: MealieClient } = {}
): Promise<{ created: ShoppingItem[]; updated: ShoppingItem[] }> {
  if (items.length === 0) {
    return { created: [], updated: [] };
  }
  const client = opts.client ?? mealie(BULK_TIMEOUT_MS);
  const body: MealieItemCreate[] = items.map((item) => ({
    shoppingListId: listId,
    quantity: item.quantity,
    foodId: item.foodId ?? null,
    unitId: item.unitId ?? null,
    note: item.note ?? "",
    recipeReferences: (item.recipeIds ?? []).map((recipeId) => ({
      recipeId,
      recipeQuantity: 1,
    })),
  }));
  const out = unwrap(
    await client.POST("/api/households/shopping/items/create-bulk", { body })
  );
  return {
    created: (out.createdItems ?? []).map(toItem),
    updated: (out.updatedItems ?? []).map(toItem),
  };
}

export async function deleteShoppingItems(
  ids: string[],
  opts: { client?: MealieClient } = {}
): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const client = opts.client ?? mealie();
  unwrap(
    await client.DELETE("/api/households/shopping/items", {
      params: { query: { ids } },
    })
  );
}

/** One item as Mealie stores it, so it can be written back whole. */
export type StoredShoppingItem = MealieItemOut;

export async function getShoppingItem(
  itemId: string,
  opts: { client?: MealieClient } = {}
): Promise<StoredShoppingItem> {
  const client = opts.client ?? mealie();
  return unwrap(
    await client.GET("/api/households/shopping/items/{item_id}", {
      params: { path: { item_id: itemId } },
    })
  );
}

/**
 * Ticks or unticks one item. Mealie's update replaces the whole item, so it
 * takes the item as just read and writes it back with only `checked` changed;
 * otherwise quantity, note and recipe references would reset to defaults.
 */
export async function setShoppingItemChecked(
  current: StoredShoppingItem,
  checked: boolean,
  opts: { client?: MealieClient } = {}
): Promise<void> {
  const client = opts.client ?? mealie();
  const body: MealieItemUpdate = {
    shoppingListId: current.shoppingListId,
    quantity: current.quantity,
    note: current.note,
    display: current.display,
    checked,
    position: current.position,
    foodId: current.foodId,
    unitId: current.unitId,
    labelId: current.labelId,
    extras: current.extras,
    recipeReferences: (current.recipeReferences ?? []).map((r) => ({
      id: r.id,
      shoppingListItemId: r.shoppingListItemId,
      recipeId: r.recipeId,
      recipeQuantity: r.recipeQuantity,
      recipeScale: r.recipeScale,
      recipeNote: r.recipeNote,
    })),
  };
  unwrap(
    await client.PUT("/api/households/shopping/items/{item_id}", {
      params: { path: { item_id: current.id } },
      body,
    })
  );
}

function toItem(i: MealieItemOut): ShoppingItem {
  return {
    id: i.id,
    listId: i.shoppingListId,
    quantity: i.quantity ?? 0,
    foodId: i.foodId ?? null,
    unitId: i.unitId ?? null,
    note: i.note ?? "",
    display: i.display ?? "",
    checked: i.checked ?? false,
    label: i.label?.name ?? i.food?.label?.name ?? null,
    position: i.position ?? 0,
  };
}

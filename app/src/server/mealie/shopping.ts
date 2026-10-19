import "server-only";

import { type MealieClient, mealie, unwrap } from "./client";
import type { components } from "./schema";

type MealieItemCreate = components["schemas"]["ShoppingListItemCreate"];
type MealieItemOut = components["schemas"]["ShoppingListItemOut-Output"];

export type ShoppingList = { id: string; name: string };

export type ShoppingItem = {
  id: string;
  quantity: number;
  foodId: string | null;
  unitId: string | null;
  note: string;
  display: string;
  checked: boolean;
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
): Promise<ShoppingList | null> {
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
  return list ? { id: list.id, name: list.name ?? name } : null;
}

export async function createShoppingList(
  name: string,
  opts: { client?: MealieClient } = {}
): Promise<ShoppingList> {
  const client = opts.client ?? mealie();
  const list = unwrap(
    await client.POST("/api/households/shopping/lists", { body: { name } })
  );
  return { id: list.id, name: list.name ?? name };
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
  const client = opts.client ?? mealie();
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

function toItem(i: MealieItemOut): ShoppingItem {
  return {
    id: i.id,
    quantity: i.quantity ?? 0,
    foodId: i.foodId ?? null,
    unitId: i.unitId ?? null,
    note: i.note ?? "",
    display: i.display ?? "",
    checked: i.checked ?? false,
  };
}

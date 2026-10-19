import "server-only";

import { eq } from "drizzle-orm";

import type { Db } from "./db/client";
import { shoppingPushes } from "./db/schema";
import { buildShoppingList, type ShoppingList } from "./domain/shopping";
import { type MealieClient, MealieError } from "./mealie/client";
import { getRecipe } from "./mealie/recipes";
import {
  addShoppingItems,
  createShoppingList,
  deleteShoppingItems,
  findShoppingListByName,
  getShoppingListItems,
  type NewShoppingItem,
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
  opts: Opts = {},
): Promise<ShoppingList> {
  const fetch = fetcher(opts);
  const plan = await getWeekPlan(db, weekStart, { fetch });
  const meals = plan.days.flatMap((d) => d.meals);
  const recipes = await loadRecipes(
    db,
    meals.map((m) => m.slug),
    { fetch },
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
    }),
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
  opts: Opts = {},
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
          (i) => i.id,
        ),
      );
      listId = previous.mealieListId;
      const stale = previous.mealieItemIds.filter((id) => current.has(id));
      await deleteShoppingItems(stale, mealie);
      replaced = stale.length;
    } catch (err) {
      // The list was deleted in Mealie: start a new one.
      if (!(err instanceof MealieError && err.notFound)) throw err;
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

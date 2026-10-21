import { eq } from "drizzle-orm";

import { formatDate } from "@/lib/format";

import "server-only";

import type { Db } from "./db/client";
import { shoppingPushes } from "./db/schema";
import {
  buildShoppingList,
  formatAmounts,
  formatProductLine,
  type WeekIngredients,
} from "./domain/shopping";
import { type MealieClient, MealieError } from "./mealie/client";
import { getRecipe } from "./mealie/recipes";
import {
  addShoppingItems,
  createShoppingList,
  deleteShoppingItems,
  findOrCreateBaseUnit,
  findShoppingListByName,
  getShoppingListItems,
  type NewShoppingItem,
} from "./mealie/shopping";
import { getWeekPlan } from "./plan";
import type { RecipeFetcher } from "./recipe-cache";

type Opts = { client?: MealieClient; fetch?: RecipeFetcher };

/** "Scrappy Meals · week of 19 Oct 2026" */
export function shoppingListName(weekStart: string): string {
  return `Scrappy Meals · week of ${formatDate(weekStart)}`;
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
): Promise<WeekIngredients> {
  const fetch = fetcher(opts);
  const plan = await getWeekPlan(db, weekStart, { fetch });
  const meals = plan.days.flatMap((d) => d.meals);
  return buildShoppingList(
    meals.map((m) => {
      const r = plan.recipes.get(m.slug);
      return {
        slug: m.slug,
        baseServings: m.baseServings,
        portions: m.portions,
        unplanned: m.unplanned,
        recipe: r
          ? {
              id: r.mealieId,
              name: r.name,
              servings: r.servings,
              ingredients: r.ingredients,
              product: r.product,
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
  /**
   * Lines Mealie merged into an unticked item already on the list (same food
   * and unit, or no unit), most likely one added by hand. The planner doesn't own those,
   * so pushing again adds its share once more.
   */
  merged: number;
};

/** The week's lines as Mealie items: foods by id and unit, the rest as notes. */
async function toItems(
  list: WeekIngredients,
  mealie: { client?: MealieClient }
): Promise<NewShoppingItem[]> {
  const baseUnits = new Map<string, Promise<string>>();
  const baseUnit = (standard: "gram" | "milliliter") => {
    const id =
      baseUnits.get(standard) ?? findOrCreateBaseUnit(standard, mealie);
    baseUnits.set(standard, id);
    return id;
  };
  const lines = await Promise.all(
    list.lines.map(async (l): Promise<NewShoppingItem> => {
      const recipeIds = l.recipes.map((r) => r.id);
      const [only, ...more] = l.amounts;
      if (!only) {
        return { quantity: 0, foodId: l.foodId, recipeIds };
      }
      // A Mealie item has one unit, so amounts that don't add up go in the
      // note: "parsley 1 bunch + 100 g".
      if (more.length > 0) {
        return {
          quantity: 0,
          foodId: l.foodId,
          note: formatAmounts(l.amounts),
          recipeIds,
        };
      }
      return {
        quantity: only.quantity,
        foodId: l.foodId,
        unitId:
          only.unitId ?? (only.standard ? await baseUnit(only.standard) : null),
        recipeIds,
      };
    })
  );

  return [
    ...lines,
    ...list.products.map((p) => ({
      quantity: 0,
      note: formatProductLine(p),
      recipeIds: [p.recipeId],
    })),
    ...list.freeText.map((f) => ({
      quantity: 0,
      note: `${f.text}${f.times > 1 ? ` (×${f.times})` : ""} · ${f.recipeName}`,
      recipeIds: [f.recipeId],
    })),
  ];
}

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
  const mealie = { client: opts.client };
  // Before anything is deleted, so a failure here leaves last week's push whole.
  const items = await toItems(
    await weekShoppingList(db, weekStart, opts),
    mealie
  );
  const name = shoppingListName(weekStart);

  const previous = await lastPush(db, weekStart);
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
    (await findShoppingListByName(name, mealie)) ??
    (await createShoppingList(name, mealie));

  const { created, updated } = await addShoppingItems(listId, items, mealie);

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

  return {
    listId,
    listName: name,
    added: created.length,
    replaced,
    merged: updated.length,
  };
}

export async function lastPush(db: Db, weekStart: string) {
  const [row] = await db
    .select()
    .from(shoppingPushes)
    .where(eq(shoppingPushes.weekStart, weekStart));
  return row ?? null;
}

import "server-only";

import type { Db } from "./db/client";
import { buildShoppingList, type WeekIngredients } from "./domain/shopping";
import { getWeekPlan } from "./plan";
import type { Defer, RecipeFetcher } from "./recipe-cache";

/** The week's lines, from the cached recipes, so it works with Mealie down. */
export async function weekShoppingList(
  db: Db,
  weekStart: string,
  opts: { fetch?: RecipeFetcher; defer?: Defer } = {}
): Promise<WeekIngredients> {
  const plan = await getWeekPlan(db, weekStart, opts);
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

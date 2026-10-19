import type { Ingredient } from "../mealie/recipes";

export type MealForShopping = {
  /** Null when the recipe is gone from Mealie. */
  recipe: {
    id: string;
    name: string;
    servings: number | null;
    ingredients: Ingredient[];
  } | null;
  slug: string;
  baseServings: number;
  portions: Record<string, number>;
};

export type ShoppingLine = {
  /** `${foodId}|${unitId ?? ""}`: lines merge only on the same food AND unit. */
  key: string;
  foodId: string;
  foodName: string;
  unitId: string | null;
  unit: string | null;
  /** Null when no recipe gave an amount ("salt to taste"). */
  quantity: number | null;
  recipes: { id: string; name: string }[];
};

export type FreeTextLine = {
  text: string;
  recipeId: string;
  recipeName: string;
  /** > 1 when the same line comes from the same recipe planned more than once. */
  times: number;
};

export type ShoppingList = {
  lines: ShoppingLine[];
  /** Ingredients Mealie hasn't parsed into a food: passed through as written, never merged. */
  freeText: FreeTextLine[];
  /** Recipes without a servings count: their ingredients are listed unscaled, as free text. */
  unscaled: string[];
  /** Planned recipes no longer in Mealie. */
  missing: string[];
};

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Builds the week's shopping list. Each recipe is scaled by the servings
 * everyone eats (base servings x sum of portions) over the recipe's own
 * servings count; amounts are then summed per food and unit. There is no unit
 * conversion: "200 g flour" and "1 cup flour" stay separate lines.
 */
export function buildShoppingList(meals: MealForShopping[]): ShoppingList {
  const lines = new Map<string, ShoppingLine>();
  const freeText = new Map<string, FreeTextLine>();
  const unscaled = new Set<string>();
  const missing = new Set<string>();

  for (const meal of meals) {
    const eaten =
      meal.baseServings *
      Object.values(meal.portions).reduce((a, b) => a + b, 0);
    if (eaten <= 0) {
      continue;
    }
    if (!meal.recipe) {
      missing.add(meal.slug);
      continue;
    }
    const { recipe } = meal;
    const scale = recipe.servings ? eaten / recipe.servings : null;
    if (scale === null) {
      unscaled.add(recipe.name);
    }
    const source = { id: recipe.id, name: recipe.name };

    for (const ing of recipe.ingredients) {
      if (!ing.food || scale === null) {
        const text = ing.display.trim() || ing.note.trim();
        if (!text) {
          continue;
        }
        const line =
          scale === null && ing.food ? `${text} (whole recipe)` : text;
        const existing = freeText.get(`${recipe.id}|${line}`);
        if (existing) {
          existing.times += 1;
        } else {
          freeText.set(`${recipe.id}|${line}`, {
            text: line,
            recipeId: recipe.id,
            recipeName: recipe.name,
            times: 1,
          });
        }
        continue;
      }
      const key = `${ing.food.id}|${ing.unit?.id ?? ""}`;
      const line = lines.get(key) ?? {
        key,
        foodId: ing.food.id,
        foodName: ing.food.name,
        unitId: ing.unit?.id ?? null,
        unit: ing.unit ? ing.unit.abbreviation || ing.unit.name : null,
        quantity: null,
        recipes: [],
      };
      if (ing.quantity !== null) {
        line.quantity = round((line.quantity ?? 0) + ing.quantity * scale);
      }
      if (!line.recipes.some((r) => r.id === recipe.id)) {
        line.recipes.push(source);
      }
      lines.set(key, line);
    }
  }

  return {
    lines: [...lines.values()].sort(
      (a, b) =>
        a.foodName.localeCompare(b.foodName) ||
        (a.unit ?? "").localeCompare(b.unit ?? "")
    ),
    freeText: [...freeText.values()],
    unscaled: [...unscaled],
    missing: [...missing],
  };
}

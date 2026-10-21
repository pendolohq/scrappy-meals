import type { Ingredient } from "../mealie/recipes";

import { type Aisle, aisleOf, aisleOrder } from "./aisles";
import { plannedServings, servingsScale, unitLabel } from "./ingredients";
import { isBaseUnit, measure, roundCount, roundMeasured } from "./units";

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

/** One amount on a line; a line holds one per kind of amount that won't add up with the others. */
export type ShoppingAmount = {
  quantity: number;
  /** "g", "ml", the unit's label, or null for a count ("2" onions). */
  unit: string | null;
  /**
   * Mealie's unit to send it with; null for a count, or for grams or
   * millilitres when no planned recipe uses a unit of exactly one.
   */
  unitId: string | null;
  /** Grams and millilitres are Mealie's standard units, found by those names. */
  standard: "gram" | "milliliter" | null;
};

export type ShoppingLine = {
  /** The food's id: a food is one line, whatever units the recipes use. */
  key: string;
  foodId: string;
  foodName: string;
  aisle: Aisle;
  /** Empty when no recipe gave an amount ("salt to taste"). */
  amounts: ShoppingAmount[];
  recipes: { id: string; name: string }[];
};

export type FreeTextLine = {
  text: string;
  recipeId: string;
  recipeName: string;
  /** > 1 when the same line comes from the same recipe planned more than once. */
  times: number;
};

export type WeekIngredients = {
  lines: ShoppingLine[];
  /** Ingredients Mealie hasn't parsed into a food: passed through as written, never merged. */
  freeText: FreeTextLine[];
  /** Recipes without a servings count: their ingredients are listed unscaled, as free text. */
  unscaled: string[];
  /** Planned recipes no longer in Mealie. */
  missing: string[];
};

type Sums = {
  foodName: string;
  label: string | null;
  /** Keyed "g", "ml", or the unit id ("" for no unit). */
  totals: Map<
    string,
    { sum: number; unit: string | null; unitId: string | null }
  >;
  recipes: { id: string; name: string }[];
};

/**
 * Builds the week's shopping list. Each recipe is scaled by the servings
 * everyone eats (base servings x sum of portions) over the recipe's own
 * servings count. Amounts are then summed per food: weights in grams, volumes
 * in millilitres (grams when the food has a density), anything else per unit.
 * Totals are rounded up only once summed, so three half onions are two onions,
 * not three.
 */
export function buildShoppingList(meals: MealForShopping[]): WeekIngredients {
  const foods = new Map<string, Sums>();
  const freeText = new Map<string, FreeTextLine>();
  const unscaled = new Set<string>();
  const missing = new Set<string>();
  // Mealie's own gram and millilitre units, as the recipes name them.
  const baseUnits: Record<"g" | "ml", string | null> = { g: null, ml: null };

  for (const meal of meals) {
    const eaten = plannedServings(meal.baseServings, meal.portions);
    if (eaten <= 0) {
      continue;
    }
    if (!meal.recipe) {
      missing.add(meal.slug);
      continue;
    }
    const { recipe } = meal;
    const scale = servingsScale(recipe.servings, eaten);
    if (scale === null) {
      unscaled.add(recipe.name);
    }
    const source = { id: recipe.id, name: recipe.name };
    // ×N counts meals: a line written twice in one recipe (say "salt" in two
    // sections) is still one recipe's worth.
    const seenText = new Set<string>();

    for (const ing of recipe.ingredients) {
      if (!ing.food || scale === null) {
        const text = ing.display.trim() || ing.note.trim();
        if (!text) {
          continue;
        }
        const line =
          scale === null && ing.food ? `${text} (whole recipe)` : text;
        const key = `${recipe.id}|${line}`;
        if (seenText.has(key)) {
          continue;
        }
        seenText.add(key);
        const existing = freeText.get(key);
        if (existing) {
          existing.times += 1;
        } else {
          freeText.set(key, {
            text: line,
            recipeId: recipe.id,
            recipeName: recipe.name,
            times: 1,
          });
        }
        continue;
      }
      const food: Sums = foods.get(ing.food.id) ?? {
        foodName: ing.food.name,
        label: null,
        totals: new Map(),
        recipes: [],
      };
      // Rows cached before labels were kept have none; any recipe's will do.
      food.label ??= ing.food.label ?? null;
      if (ing.quantity !== null) {
        addAmount(food, ing, ing.quantity * scale, baseUnits);
      }
      if (!food.recipes.some((r) => r.id === recipe.id)) {
        food.recipes.push(source);
      }
      foods.set(ing.food.id, food);
    }
  }

  const lines = [...foods.entries()].map(([foodId, food]): ShoppingLine => ({
    key: foodId,
    foodId,
    foodName: food.foodName,
    aisle: aisleOf(food.label),
    amounts: [...food.totals.entries()]
      .map(([key, t]): ShoppingAmount => {
        if (key === "g" || key === "ml") {
          return {
            quantity: roundMeasured(t.sum),
            unit: key,
            unitId: baseUnits[key],
            standard: key === "g" ? "gram" : "milliliter",
          };
        }
        return {
          quantity: roundCount(t.sum),
          unit: t.unit,
          unitId: t.unitId,
          standard: null,
        };
      })
      .toSorted((a, b) => amountOrder(a) - amountOrder(b)),
    recipes: food.recipes,
  }));

  return {
    lines: lines.toSorted(
      (a, b) =>
        aisleOrder(a.aisle) - aisleOrder(b.aisle) ||
        a.foodName.localeCompare(b.foodName)
    ),
    freeText: [...freeText.values()],
    unscaled: [...unscaled],
    missing: [...missing],
  };
}

function addAmount(
  food: Sums,
  ing: Ingredient,
  quantity: number,
  baseUnits: Record<"g" | "ml", string | null>
) {
  const measured = ing.unit ? measure(quantity, ing.unit) : null;
  let key: string;
  let amount = quantity;
  if (measured) {
    baseUnits[measured.per] ??= isBaseUnit(ing.unit, measured.per)
      ? ing.unit!.id
      : null;
    const density = ing.food?.gramsPerMl;
    if (measured.per === "ml" && density) {
      key = "g";
      amount = measured.amount * density;
    } else {
      key = measured.per;
      amount = measured.amount;
    }
  } else {
    key = ing.unit?.id ?? "";
  }
  const total = food.totals.get(key) ?? {
    sum: 0,
    unit: measured ? null : unitLabel(ing.unit),
    unitId: measured ? null : (ing.unit?.id ?? null),
  };
  total.sum += amount;
  food.totals.set(key, total);
}

/** Grams, then millilitres, then counts, then other units. */
const amountOrder = (a: ShoppingAmount) =>
  a.standard === "gram"
    ? 0
    : a.standard === "milliliter"
      ? 1
      : a.unit === null
        ? 2
        : 3;

/** "200 g", "2", "100 g + 1 bunch": how a line's amounts read, in the preview and in Mealie. */
export const formatAmounts = (amounts: ShoppingAmount[]) =>
  amounts.map((a) => `${a.quantity}${a.unit ? ` ${a.unit}` : ""}`).join(" + ");

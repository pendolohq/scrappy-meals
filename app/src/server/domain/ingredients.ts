import type { Ingredient } from "../mealie/recipes";

/**
 * Recipe amounts are kept to two decimals. The shopping list rounds its own
 * totals up instead (`roundMeasured`, `roundCount`), once they're summed.
 */
export const roundQuantity = (n: number) => Math.round(n * 100) / 100;

/** "g" for grams: the abbreviation when Mealie has one. */
export const unitLabel = (unit: Ingredient["unit"]) =>
  unit ? unit.abbreviation || unit.name : null;

/** Servings the household eats of a planned meal: base servings x everyone's portions. */
export const plannedServings = (
  baseServings: number,
  portions: Record<string, number>
) => baseServings * Object.values(portions).reduce((a, b) => a + b, 0);

/** How much of the recipe `servings` is: null without a servings count. */
export const servingsScale = (
  recipeServings: number | null,
  servings: number
) => (recipeServings ? servings / recipeServings : null);

export const MIN_COOKING_FOR = 0.25;
export const MAX_COOKING_FOR = 100;
const BELOW_ONE = [0.25, 0.5];

/**
 * "Cooking for" one step down or up: whole servings from one upwards, halves
 * and quarters below it (cooking half a recipe for one), so ¼ ½ 1 2 3…
 * A value off that ladder, like the plan's 1½, moves to its neighbour.
 */
export function stepServings(current: number, direction: 1 | -1): number {
  if (direction === 1) {
    if (current < 1) {
      return BELOW_ONE.find((v) => v > current) ?? 1;
    }
    return Math.min(MAX_COOKING_FOR, Math.floor(current) + 1);
  }
  if (current > 1) {
    return Math.max(1, Math.ceil(current) - 1);
  }
  return BELOW_ONE.findLast((v) => v < current) ?? MIN_COOKING_FOR;
}

export type IngredientLine = {
  /** Section heading shown above this line. */
  title: string | null;
  /**
   * The line scaled to the servings asked for. Null when it is shown as
   * written: no food or amount (unparsed, "to taste"), or the recipe has no
   * servings count to scale by.
   */
  scaled: {
    quantity: number;
    unit: string | null;
    food: string;
    note: string;
  } | null;
  /** The line as Mealie renders it; empty for a lone heading. */
  text: string;
  /** What instruction steps link to; null when Mealie has none. */
  referenceId: string | null;
};

/**
 * A recipe's ingredients for `servings` servings, scaled as the shopping list
 * scales them (`buildShoppingList`) but kept in the recipe's own units: a
 * cook measures "2 tbsp", a shopper buys grams.
 */
export function scaleIngredients(
  ingredients: Ingredient[],
  recipeServings: number | null,
  servings: number
): IngredientLine[] {
  const scale = servingsScale(recipeServings, servings);
  return ingredients.flatMap((ing): IngredientLine[] => {
    const text = ing.display.trim() || ing.note.trim();
    const title = ing.title ?? null;
    const referenceId = ing.referenceId ?? null;
    if (ing.food && ing.quantity !== null && scale !== null) {
      return [
        {
          title,
          scaled: {
            quantity: roundQuantity(ing.quantity * scale),
            unit: unitLabel(ing.unit),
            food: ing.food.name,
            note: ing.note.trim(),
          },
          text,
          referenceId,
        },
      ];
    }
    // A heading can sit on an otherwise empty line.
    return text || title ? [{ title, scaled: null, text, referenceId }] : [];
  });
}

/**
 * The lines a step links to, in the ingredient list's order, from the lines
 * `scaleIngredients` gave so they follow the same servings. A link to a line
 * that's gone, or to a lone heading, shows nothing; headings aren't repeated
 * under the step.
 */
export function stepIngredients(
  lines: IngredientLine[],
  refs: string[] | undefined
): IngredientLine[] {
  if (!refs || refs.length === 0) {
    return [];
  }
  const linked = new Set(refs);
  return lines.flatMap((line) =>
    line.referenceId &&
    linked.has(line.referenceId) &&
    (line.scaled || line.text)
      ? [{ ...line, title: null }]
      : []
  );
}

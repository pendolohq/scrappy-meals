import { MACRO_KEYS, type Macros, type RecipeNutrition } from "../mealie/nutrition";

export type MealForMacros = {
  /** Null when the recipe is gone from Mealie. */
  nutrition: RecipeNutrition | null;
  recipeName: string;
  /** Servings one person eats at multiplier 1. */
  baseServings: number;
  /** Portion multiplier per user id; missing = 0. */
  portions: Record<string, number>;
};

export type PersonDayTotals = {
  /** Sum of every value we know. Never includes estimates. */
  macros: Macros;
  /** True when at least one eaten meal lacks some nutrition, so the totals are a lower bound. */
  incomplete: boolean;
  /** Names of eaten recipes that lack nutrition data, for the warning. */
  incompleteRecipes: string[];
  mealsEaten: number;
};

export const servingsEaten = (meal: Pick<MealForMacros, "baseServings" | "portions">, userId: string) =>
  meal.baseServings * (meal.portions[userId] ?? 0);

export function personDayTotals(meals: MealForMacros[], userId: string): PersonDayTotals {
  const macros: Macros = { kcal: 0, protein: 0, carbs: 0, fat: 0, fibre: 0 };
  const incompleteRecipes = new Set<string>();
  let mealsEaten = 0;

  for (const meal of meals) {
    const servings = servingsEaten(meal, userId);
    if (servings <= 0) continue;
    mealsEaten += 1;
    if (!meal.nutrition || meal.nutrition.status !== "complete") incompleteRecipes.add(meal.recipeName);
    if (!meal.nutrition) continue;
    for (const key of MACRO_KEYS) {
      const perServing = meal.nutrition.perServing[key];
      if (perServing !== undefined) macros[key] += perServing * servings;
    }
  }

  for (const key of MACRO_KEYS) macros[key] = Math.round(macros[key] * 10) / 10;
  return { macros, incomplete: incompleteRecipes.size > 0, incompleteRecipes: [...incompleteRecipes], mealsEaten };
}

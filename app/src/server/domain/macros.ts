import {
  MACRO_KEYS,
  type Macros,
  type RecipeNutrition,
} from "../mealie/nutrition";

import { type AdherenceStatus, EATEN_SHARE } from "./adherence";

export type MealForMacros = {
  /** Null when the recipe is gone from Mealie. */
  nutrition: RecipeNutrition | null;
  recipeName: string;
  /** True when the nutrition is an AI estimate nobody has checked yet. */
  estimated?: boolean;
  /** Servings one person eats at multiplier 1. */
  baseServings: number;
  /** Portion multiplier per user id; missing = 0. */
  portions: Record<string, number>;
  /**
   * What each person logged, by user id. Left out, the totals are the plan;
   * given, a skipped meal counts as nothing and a partly eaten one as half.
   */
  logged?: Record<string, AdherenceStatus | undefined>;
};

export type PersonDayTotals = {
  /**
   * Sum of every value we have. AI-estimated recipes count too, so the totals
   * stay usable; they're listed in `estimatedRecipes` for the label.
   */
  macros: Macros;
  /** True when at least one eaten meal lacks some nutrition, so the totals are a lower bound. */
  incomplete: boolean;
  /** Names of eaten recipes that lack nutrition data, for the warning. */
  incompleteRecipes: string[];
  /** Names of eaten recipes whose nutrition is an unchecked estimate. */
  estimatedRecipes: string[];
  mealsEaten: number;
};

export const emptyMacros = (): Macros => ({
  kcal: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  fibre: 0,
});

export const roundMacros = (macros: Macros): Macros => {
  const out = emptyMacros();
  for (const key of MACRO_KEYS) {
    out[key] = Math.round(macros[key] * 10) / 10;
  }
  return out;
};

/** Servings a person eats of a meal at `multiplier`, after what they logged. */
export const servingsEaten = (
  baseServings: number,
  multiplier: number,
  logged: AdherenceStatus | undefined
) => baseServings * multiplier * (logged ? EATEN_SHARE[logged] : 1);

export function personDayTotals(
  meals: MealForMacros[],
  userId: string
): PersonDayTotals {
  const macros = emptyMacros();
  const incompleteRecipes = new Set<string>();
  const estimatedRecipes = new Set<string>();
  let mealsEaten = 0;

  for (const meal of meals) {
    const servings = servingsEaten(
      meal.baseServings,
      meal.portions[userId] ?? 0,
      meal.logged?.[userId]
    );
    if (servings <= 0) {
      continue;
    }
    mealsEaten += 1;
    if (meal.estimated && meal.nutrition) {
      estimatedRecipes.add(meal.recipeName);
    }
    if (!meal.nutrition || meal.nutrition.status !== "complete") {
      incompleteRecipes.add(meal.recipeName);
    }
    if (!meal.nutrition) {
      continue;
    }
    for (const key of MACRO_KEYS) {
      const perServing = meal.nutrition.perServing[key];
      if (perServing !== undefined) {
        macros[key] += perServing * servings;
      }
    }
  }

  return {
    macros: roundMacros(macros),
    incomplete: incompleteRecipes.size > 0,
    incompleteRecipes: [...incompleteRecipes],
    estimatedRecipes: [...estimatedRecipes],
    mealsEaten,
  };
}

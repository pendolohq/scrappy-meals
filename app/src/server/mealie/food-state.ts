import { FOOD_UNITS, type FoodServing } from "../domain/food";

/**
 * What marks a recipe as a single food added by name, kept in the recipe's
 * `extras` (string key/values) next to the import state: the Mealie food on
 * its one line, and what one serving is.
 */
export const FOOD_EXTRAS = {
  food: "scrappyFood",
  amount: "scrappyFoodAmount",
  unit: "scrappyFoodUnit",
  grams: "scrappyFoodGrams",
} as const;

export type FoodState = FoodServing & { foodId: string };

const positive = (value: unknown): number | null => {
  const n = typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** The food a recipe stands for; null for any other recipe or unreadable extras. */
export function readFoodState(
  extras: Record<string, unknown> | null | undefined
): FoodState | null {
  const foodId = extras?.[FOOD_EXTRAS.food];
  const amount = positive(extras?.[FOOD_EXTRAS.amount]);
  const unit = FOOD_UNITS.find((u) => u === extras?.[FOOD_EXTRAS.unit]);
  if (typeof foodId !== "string" || !foodId || amount === null || !unit) {
    return null;
  }
  return {
    foodId,
    amount,
    unit,
    grams: positive(extras?.[FOOD_EXTRAS.grams]),
  };
}

/**
 * The recipe's extras with the food written in. Other keys are kept: a PATCH
 * replaces `extras` as a whole.
 */
export function withFoodState(
  extras: Record<string, unknown> | null | undefined,
  state: FoodState
): Record<string, string> {
  const next = Object.fromEntries(
    Object.entries(extras ?? {}).filter(
      (e): e is [string, string] => typeof e[1] === "string"
    )
  );
  next[FOOD_EXTRAS.food] = state.foodId;
  next[FOOD_EXTRAS.amount] = String(state.amount);
  next[FOOD_EXTRAS.unit] = state.unit;
  if (state.grams === null) {
    delete next[FOOD_EXTRAS.grams];
  } else {
    next[FOOD_EXTRAS.grams] = String(state.grams);
  }
  return next;
}

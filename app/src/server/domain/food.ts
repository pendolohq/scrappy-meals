import { MACRO_KEYS, type Macros } from "../mealie/nutrition";
import type { Ingredient } from "../mealie/recipes";

import type { UsdaPortion } from "./usda";
import { type FoodMatch, lineResult, roundMacro, volumeMl } from "./usda-check";

/**
 * How a single food is measured: by the piece (a kiwi), in grams or in
 * millilitres. A piece always has a weight behind it, the food's USDA match's
 * `pieceGrams` (or one typed in when there is no match).
 */
export const FOOD_UNITS = ["piece", "g", "ml"] as const;
export type FoodUnit = (typeof FOOD_UNITS)[number];

/** One serving of a food recipe: "1 piece", "150 g", "180 ml". */
export type FoodServing = {
  amount: number;
  unit: FoodUnit;
  /** What it weighs; null for millilitres of a food with no known density. */
  grams: number | null;
};

/** The food on a recipe's one line, as Mealie has it. */
export type LineFood = { id: string; name: string; gramsPerMl: number | null };

/**
 * The Mealie units a food recipe's line uses, by the names Mealie gives its
 * standard units ("gram" is 1 `gram`), so the line converts like any other.
 */
export const LINE_UNITS = {
  g: {
    name: "gram",
    abbreviation: "g",
    standardUnit: "gram",
    standardQuantity: 1,
  },
  ml: {
    name: "milliliter",
    abbreviation: "ml",
    standardUnit: "milliliter",
    standardQuantity: 1,
  },
} as const;

const trim = (n: number) => String(Math.round(n * 100) / 100);

/**
 * "1 piece (69 g)", "2 pieces (138 g)", "150 g", "180 ml". `grams` is left
 * out where it would only repeat the amount or isn't known.
 */
export function servingLabel(serving: FoodServing): string {
  if (serving.unit !== "piece") {
    return `${trim(serving.amount)} ${serving.unit}`;
  }
  const pieces = `${trim(serving.amount)} ${serving.amount === 1 ? "piece" : "pieces"}`;
  return serving.grams === null
    ? pieces
    : `${pieces} (${trim(serving.grams)} g)`;
}

/**
 * The recipe's one ingredient line. Pieces have no unit ("2 Kiwi"), which is
 * how the USDA check weighs them (the match's piece weight) and how the
 * shopping list counts them. Grams and millilitres are in `mealieUnit`, the
 * unit the recipe will have, else an ideal one for a preview.
 */
export function foodLine(
  serving: Pick<FoodServing, "amount" | "unit">,
  food: LineFood,
  mealieUnit?: Ingredient["unit"]
): Ingredient {
  const unit =
    serving.unit === "piece"
      ? null
      : (mealieUnit ?? { id: serving.unit, ...LINE_UNITS[serving.unit] });
  return {
    quantity: serving.amount,
    food,
    unit,
    note: "",
    display: [trim(serving.amount), unit?.abbreviation, food.name]
      .filter(Boolean)
      .join(" "),
  };
}

export type ServingNutrition =
  | { grams: number; perServing: Partial<Macros> }
  | { problem: "no piece weight" | "no volume weight" };

/**
 * One serving's nutrition from the food's confirmed USDA match, counted the
 * way the USDA check counts the recipe's line, so the two always agree.
 */
export function servingNutrition(
  serving: Pick<FoodServing, "amount" | "unit">,
  food: LineFood,
  match: FoodMatch,
  mealieUnit?: Ingredient["unit"]
): ServingNutrition {
  const result = lineResult(foodLine(serving, food, mealieUnit), match);
  if (result.kind !== "counted") {
    return {
      problem: serving.unit === "ml" ? "no volume weight" : "no piece weight",
    };
  }
  const perServing: Partial<Macros> = {};
  for (const key of MACRO_KEYS) {
    const value = result.macros[key];
    if (value !== undefined) {
      perServing[key] = roundMacro(key, value);
    }
  }
  return { grams: result.grams, perServing };
}

// A weight is not what one of something weighs.
const WEIGHTS = new Set(["g", "gram", "oz", "ounce", "lb", "pound", "kg"]);

/**
 * The USDA portions that could be one piece of the food ("1 fruit", "1
 * medium"): volumes and plain weights left out.
 */
export const piecePortions = (portions: UsdaPortion[]): UsdaPortion[] =>
  portions.filter(
    (p) =>
      volumeMl(p) === undefined && !WEIGHTS.has(p.measure.trim().toLowerCase())
  );

/** The piece to start from: a medium one when USDA has sizes, else the first. */
export const defaultPiece = (portions: UsdaPortion[]): UsdaPortion | null => {
  const pieces = piecePortions(portions);
  return pieces.find((p) => p.measure === "medium") ?? pieces[0] ?? null;
};

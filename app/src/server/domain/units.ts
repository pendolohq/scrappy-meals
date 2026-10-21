import type { Ingredient } from "../mealie/recipes";

/**
 * Mealie's names for standard units (`standardUnit` on a unit, with
 * `standardQuantity` of it per unit), in grams or millilitres. Volumes are US
 * customary, as Mealie's are.
 */
const STANDARD: Record<string, { per: "g" | "ml"; factor: number }> = {
  milligram: { per: "g", factor: 0.001 },
  gram: { per: "g", factor: 1 },
  kilogram: { per: "g", factor: 1000 },
  ounce: { per: "g", factor: 28.349_523_125 },
  pound: { per: "g", factor: 453.592_37 },
  milliliter: { per: "ml", factor: 1 },
  centiliter: { per: "ml", factor: 10 },
  deciliter: { per: "ml", factor: 100 },
  liter: { per: "ml", factor: 1000 },
  teaspoon: { per: "ml", factor: 4.928_921_593_75 },
  tablespoon: { per: "ml", factor: 14.786_764_781_25 },
  fluid_ounce: { per: "ml", factor: 29.573_529_562_5 },
  cup: { per: "ml", factor: 236.588_236_5 },
  pint: { per: "ml", factor: 473.176_473 },
  quart: { per: "ml", factor: 946.352_946 },
  gallon: { per: "ml", factor: 3785.411_784 },
};

export type Measured = { per: "g" | "ml"; amount: number };

/**
 * An amount in grams or millilitres, when its unit is a weight or a volume
 * Mealie knows the size of. Null for units that don't convert (bunch, clove,
 * pinch, can) and for no unit at all.
 */
export function measure(
  quantity: number,
  unit: Ingredient["unit"]
): Measured | null {
  const standard = unit?.standardUnit ? STANDARD[unit.standardUnit] : null;
  if (!standard || !unit?.standardQuantity) {
    return null;
  }
  return {
    per: standard.per,
    amount: quantity * unit.standardQuantity * standard.factor,
  };
}

/** Whether a unit is exactly one gram or one millilitre. */
export const isBaseUnit = (unit: Ingredient["unit"], per: "g" | "ml") =>
  unit?.standardQuantity === 1 &&
  unit.standardUnit === (per === "g" ? "gram" : "milliliter");

// Two decimals first, so 0.1 + 0.2 counts as 0.3 and not as just over it.
const ceil = (n: number) => Math.ceil(Math.round(n * 100) / 100);

/**
 * Grams or millilitres to buy: whole ones up to 100, then the next 10 up.
 * Rounded up, so the total is never short.
 */
export const roundMeasured = (n: number) =>
  n <= 100 ? ceil(n) : ceil(n / 10) * 10;

/**
 * Anything else to buy is counted, so it's rounded up to a whole one: half an
 * onion is still an onion to buy.
 */
export const roundCount = ceil;

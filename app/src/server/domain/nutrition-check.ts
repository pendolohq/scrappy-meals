import type { Macros } from "../mealie/nutrition";

// Fibre is partly fermented (about 2 kcal/g), carbs may or may not include it,
// and labels round, so the energy check allows a margin either way.
const TOLERANCE = 0.25;
const SLACK_KCAL = 30;

/** Above this a "serving" is more likely the whole dish. */
export const MAX_SERVING_KCAL = 1500;
/** Below this a "serving" is more likely per 100 g. */
export const MIN_SERVING_KCAL = 150;

/** kcal from the macros, at 4 per gram of protein and carbs and 9 of fat. */
export const kcalFromMacros = ({
  protein,
  carbs,
  fat,
}: Pick<Macros, "protein" | "carbs" | "fat">) =>
  4 * protein + 4 * carbs + 9 * fat;

/**
 * Whether kcal agree with protein, carbs and fat. True when any of the four
 * is missing: there is nothing to compare.
 */
export function kcalMatchesMacros(m: Partial<Macros>): boolean {
  const { kcal, protein, carbs, fat } = m;
  if (
    kcal === undefined ||
    protein === undefined ||
    carbs === undefined ||
    fat === undefined
  ) {
    return true;
  }
  const expected = kcalFromMacros({ protein, carbs, fat });
  return (
    kcal >= expected * (1 - TOLERANCE) - SLACK_KCAL &&
    kcal <= expected * (1 + TOLERANCE) + SLACK_KCAL
  );
}

/**
 * What looks wrong about a recipe's nutrition per serving. Pages don't always
 * mean "per serving" (some give the whole dish or 100 g), and nothing else
 * catches that: the totals would just be off by a few times.
 */
export function nutritionWarnings(perServing: Partial<Macros>): string[] {
  const warnings: string[] = [];
  const { kcal, protein, carbs, fat } = perServing;
  if (kcal !== undefined && kcal > MAX_SERVING_KCAL) {
    warnings.push(
      `Over ${MAX_SERVING_KCAL} kcal a serving: the page may give the whole dish. Check the servings.`
    );
  }
  if (kcal !== undefined && kcal > 0 && kcal < MIN_SERVING_KCAL) {
    warnings.push(
      `Under ${MIN_SERVING_KCAL} kcal a serving: check the page doesn't give it per 100 g.`
    );
  }
  if (!kcalMatchesMacros(perServing)) {
    const expected = Math.round(
      kcalFromMacros({ protein: protein!, carbs: carbs!, fat: fat! })
    );
    warnings.push(
      `The calories don't match the macros, which come to about ${expected} kcal. One of them is probably wrong.`
    );
  }
  return warnings;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Values per serving when the same dish is cut into `to` servings instead of
 * `from`. kcal to the unit, grams to one decimal, as the review page shows them.
 */
export function rescalePerServing(
  perServing: Partial<Macros>,
  from: number,
  to: number
): Partial<Macros> {
  const out: Partial<Macros> = {};
  for (const [key, value] of Object.entries(perServing) as [
    keyof Macros,
    number,
  ][]) {
    const scaled = (value * from) / to;
    out[key] = key === "kcal" ? Math.round(scaled) : round1(scaled);
  }
  return out;
}

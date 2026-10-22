import {
  parseDecimal,
  THREE_DIGIT_GROUP,
  type ThreeDigitGroup,
} from "../domain/decimal";

import type { components } from "./schema";

type MealieNutrition = components["schemas"]["Nutrition"];

export const MACRO_KEYS = ["kcal", "protein", "carbs", "fat", "fibre"] as const;
export type MacroKey = (typeof MACRO_KEYS)[number];
export type Macros = Record<MacroKey, number>;

/**
 * Nutrition for one serving, as Mealie stores it. Mealie's values are per
 * serving (schema.org NutritionInformation; Mealie's own import schema says
 * "per serving"), in kcal and grams.
 *
 * A macro is only present when Mealie has a value we can read unambiguously.
 * Nothing is guessed here: anything blank, a range, or with an unexpected
 * unit is reported as missing so the UI can flag the recipe. Estimates are
 * written to Mealie like any other value (see `nutrition-estimate.ts`).
 */
export type RecipeNutrition = {
  perServing: Partial<Macros>;
  missing: MacroKey[];
  status: "complete" | "partial" | "missing";
};

const GRAMS = ["g", "grams"];

const FIELDS = {
  kcal: { key: "calories", units: ["kcal", "cal", "calories"] },
  protein: { key: "proteinContent", units: GRAMS },
  carbs: { key: "carbohydrateContent", units: GRAMS },
  fat: { key: "fatContent", units: GRAMS },
  fibre: { key: "fiberContent", units: GRAMS },
} as const satisfies Record<
  MacroKey,
  { key: keyof MealieNutrition; units: readonly string[] }
>;

/** The Mealie nutrition field each macro is stored in. */
export const NUTRITION_FIELDS = Object.fromEntries(
  MACRO_KEYS.map((m) => [m, FIELDS[m].key])
) as { [K in MacroKey]: (typeof FIELDS)[K]["key"] };

const NUMBER_WITH_UNIT = /^(\d[\d.,]*)\s*([a-z]*)$/i;

/**
 * Parses one Mealie nutrition string ("12", "12.5", "12,5 g", "1.200 kcal");
 * null if not clean. See `parseDecimal` for "1,200".
 */
export function parseNutritionValue(
  raw: string | null | undefined,
  units: readonly string[],
  threeDigitGroup: ThreeDigitGroup = "refuse"
): number | null {
  const text = raw?.trim();
  if (!text) {
    return null;
  }
  const m = NUMBER_WITH_UNIT.exec(text);
  if (!m) {
    return null;
  }
  const unit = m[2].toLowerCase();
  if (unit && !units.includes(unit)) {
    return null;
  }
  return parseDecimal(m[1], threeDigitGroup);
}

export function normaliseNutrition(
  nutrition: MealieNutrition | null | undefined
): RecipeNutrition {
  const perServing: Partial<Macros> = {};
  const missing: MacroKey[] = [];
  for (const macro of MACRO_KEYS) {
    const { key, units } = FIELDS[macro];
    const value = parseNutritionValue(
      nutrition?.[key],
      units,
      THREE_DIGIT_GROUP[macro]
    );
    if (value === null) {
      missing.push(macro);
    } else {
      perServing[macro] = value;
    }
  }
  const status =
    missing.length === 0
      ? "complete"
      : missing.length === MACRO_KEYS.length
        ? "missing"
        : "partial";
  return { perServing, missing, status };
}

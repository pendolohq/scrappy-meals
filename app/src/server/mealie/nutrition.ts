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
 * We never estimate: anything blank, a range, or with an unexpected unit is
 * reported as missing so the UI can flag the recipe.
 */
export type RecipeNutrition = {
  perServing: Partial<Macros>;
  missing: MacroKey[];
  status: "complete" | "partial" | "missing";
};

const FIELDS: Record<
  MacroKey,
  { key: keyof MealieNutrition; units: string[] }
> = {
  kcal: { key: "calories", units: ["kcal", "cal", "calories"] },
  protein: { key: "proteinContent", units: ["g", "grams"] },
  carbs: { key: "carbohydrateContent", units: ["g", "grams"] },
  fat: { key: "fatContent", units: ["g", "grams"] },
  fibre: { key: "fiberContent", units: ["g", "grams"] },
};

/** The Mealie nutrition field each macro is stored in. */
export const NUTRITION_FIELDS = Object.fromEntries(
  MACRO_KEYS.map((m) => [m, FIELDS[m].key])
) as { [K in MacroKey]: (typeof FIELDS)[K]["key"] };

const NUMBER_WITH_UNIT = /^(\d+(?:[.,]\d+)?)\s*([a-z]*)$/i;

/** Parses one Mealie nutrition string ("12", "12.5", "12,5 g", "250 kcal"); null if not clean. */
export function parseNutritionValue(
  raw: string | null | undefined,
  units: string[]
): number | null {
  const text = raw?.trim();
  if (!text) {
    return null;
  }
  const m = NUMBER_WITH_UNIT.exec(text);
  if (!m) {
    return null;
  }
  // "1,200" is a thousands separator as often as a decimal comma; don't guess.
  if (/,\d{3}$/.test(m[1])) {
    return null;
  }
  const unit = m[2].toLowerCase();
  if (unit && !units.includes(unit)) {
    return null;
  }
  const value = Number(m[1].replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

export function normaliseNutrition(
  nutrition: MealieNutrition | null | undefined
): RecipeNutrition {
  const perServing: Partial<Macros> = {};
  const missing: MacroKey[] = [];
  for (const macro of MACRO_KEYS) {
    const { key, units } = FIELDS[macro];
    const value = parseNutritionValue(nutrition?.[key], units);
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

import { MACRO_KEYS, type MacroKey, type Macros } from "../mealie/nutrition";
import type { Ingredient } from "../mealie/recipes";

import { measure } from "./units";
import {
  isNegligible,
  OWN_VALUES,
  type UsdaFood,
  type UsdaPortion,
} from "./usda";

/** A Mealie food's USDA match, with the cached USDA food. */
export type FoodMatch = {
  fdcId: number;
  status: "suggested" | "confirmed";
  /** What one of it weighs, for lines with no unit ("2 kiwis"). */
  pieceGrams: number | null;
  /**
   * What one of a unit weighs for this food ("clove": 3), by `unitKey`, for
   * units that are neither a weight nor a volume.
   */
  unitGrams: Record<string, number>;
  /** Grams to count for a line with no amount; null leaves such lines out. */
  defaultGrams: number | null;
  food: UsdaFood;
};

export type LineResult =
  | { kind: "skipped" }
  /**
   * Left out of the total and listed: a line with no amount ("olive oil, to
   * taste"), or one Mealie couldn't parse, which is mostly a serving
   * suggestion or another recipe ("½ batch", "carb source of choice").
   */
  | { kind: "notCounted"; reason: "no amount" | "not parsed" }
  | { kind: "needsAmount"; reason: string }
  | { kind: "unmatched"; foodId: string; foodName: string }
  | {
      kind: "counted";
      grams: number;
      macros: Partial<Macros>;
      /** The line gave no amount: `grams` is the food's default. */
      assumed?: true;
    };

/** A macro is outside when Mealie and USDA differ by more than the larger of these. */
export const CHECK_THRESHOLD = {
  share: 0.1,
  floor: { kcal: 20, grams: 3 },
} as const;

export function isOutside(
  macro: MacroKey,
  mealie: number | undefined,
  usda: number
): boolean {
  if (mealie === undefined) {
    return true;
  }
  const floor =
    macro === "kcal" ? CHECK_THRESHOLD.floor.kcal : CHECK_THRESHOLD.floor.grams;
  const allowed = Math.max(CHECK_THRESHOLD.share * Math.abs(usda), floor);
  return Math.abs(mealie - usda) > allowed + 1e-9;
}

// Millilitres in a US measure, as in units.ts.
const VOLUME_ML: Record<string, number> = {
  cup: 236.588_236_5,
  tablespoon: 14.786_764_781_25,
  tbsp: 14.786_764_781_25,
  teaspoon: 4.928_921_593_75,
  tsp: 4.928_921_593_75,
  "fl oz": 29.573_529_562_5,
  "fluid ounce": 29.573_529_562_5,
  ml: 1,
  milliliter: 1,
  millilitre: 1,
  l: 1000,
  liter: 1000,
  litre: 1000,
};

const normalise = (name: string) => {
  const n = name.trim().toLowerCase();
  return n.length > 3 && n.endsWith("s") && !n.endsWith("ss")
    ? n.slice(0, -1)
    : n;
};

// Italian unit names, plus English plurals the trailing-s rule gets wrong ("leaves").
const UNIT_ALIASES: Record<string, string> = {
  leave: "leaf",
  spicchio: "clove",
  spicchi: "clove",
  fetta: "slice",
  fette: "slice",
  foglia: "leaf",
  foglie: "leaf",
  rametto: "sprig",
  rametti: "sprig",
  mazzo: "bunch",
  mazzi: "bunch",
  pizzico: "pinch",
  pizzichi: "pinch",
  pezzo: "piece",
  pezzi: "piece",
  scatola: "can",
  scatole: "can",
  lattina: "can",
  lattine: "can",
};

const canonical = (name: string) => {
  const n = normalise(name);
  return UNIT_ALIASES[n] ?? n;
};

/** How a unit is stored in `unitGrams`: "Cloves" and "spicchi" are both "clove". */
export const unitKey = (unit: { name: string }) => canonical(unit.name);

const volumeMl = (p: UsdaPortion) => VOLUME_ML[p.measure.trim().toLowerCase()];

/**
 * Per 100 g as the app counts it: carbs without fibre, as on UK and EU labels
 * and in the recipes' own figures. USDA's carbs include fibre; values typed in
 * from a label already leave it out.
 */
export function per100gCounted(food: UsdaFood): Partial<Macros> {
  const { carbs, fibre } = food.per100g;
  if (food.dataType === OWN_VALUES || carbs === undefined || !fibre) {
    return food.per100g;
  }
  return { ...food.per100g, carbs: Math.max(0, carbs - fibre) };
}

function scale(food: UsdaFood, grams: number): Partial<Macros> {
  const per100g = per100gCounted(food);
  const macros: Partial<Macros> = {};
  for (const key of MACRO_KEYS) {
    const per100 = per100g[key];
    if (per100 !== undefined) {
      macros[key] = (grams * per100) / 100;
    }
  }
  return macros;
}

const needsAmount = (reason: string): LineResult => ({
  kind: "needsAmount",
  reason,
});

/**
 * What one ingredient line adds, from grams: its weight or volume, the
 * match's weight for its unit or a USDA portion for it, or the match's piece
 * weight. Nothing is guessed: a line with no amount, or one Mealie couldn't
 * parse, isn't counted at all.
 */
export function lineResult(
  line: Ingredient,
  match: FoodMatch | undefined
): LineResult {
  const { food } = line;
  if (!food) {
    return line.display.trim() === ""
      ? { kind: "skipped" }
      : { kind: "notCounted", reason: "not parsed" };
  }
  const { quantity, unit } = line;
  // Nothing to weigh: a food with next to no nutrients (salt, water) counts
  // as 0 g, a food with a default amount counts that and says so, and any
  // other line is left out, matched or not.
  if (quantity === null) {
    if (match?.status !== "confirmed") {
      return { kind: "notCounted", reason: "no amount" };
    }
    if (isNegligible(match.food.per100g)) {
      return { kind: "counted", grams: 0, macros: scale(match.food, 0) };
    }
    return match.defaultGrams
      ? {
          kind: "counted",
          grams: match.defaultGrams,
          macros: scale(match.food, match.defaultGrams),
          assumed: true,
        }
      : { kind: "notCounted", reason: "no amount" };
  }
  if (match?.status !== "confirmed") {
    return { kind: "unmatched", foodId: food.id, foodName: food.name };
  }
  const usda = match.food;
  const counted = (grams: number): LineResult => ({
    kind: "counted",
    grams,
    macros: scale(usda, grams),
  });

  const measured = measure(quantity, unit);
  if (measured?.per === "g") {
    return counted(measured.amount);
  }
  if (measured?.per === "ml") {
    if (food.gramsPerMl) {
      return counted(measured.amount * food.gramsPerMl);
    }
    const portion = usda.portions.find((p) => volumeMl(p) !== undefined);
    return portion
      ? counted((measured.amount * portion.grams) / volumeMl(portion)!)
      : needsAmount("no weight for this volume");
  }
  if (unit) {
    const own = match.unitGrams[unitKey(unit)];
    if (own) {
      return counted(quantity * own);
    }
    const names = [unit.name, unit.abbreviation].map(canonical).filter(Boolean);
    const portion = usda.portions.find((p) =>
      names.includes(canonical(p.measure))
    );
    return portion
      ? counted(quantity * portion.grams)
      : needsAmount(`no weight for ${unit.name.trim()}`);
  }
  return match.pieceGrams
    ? counted(quantity * match.pieceGrams)
    : needsAmount("no weight for one");
}

export type CheckStatus = "match" | "mismatch" | "reviewed" | "cantCheck";

export type RecipeCheck = {
  status: CheckStatus;
  /** Macros outside the threshold; empty when the recipe can't be checked. */
  outside: MacroKey[];
  mealie: Partial<Macros>;
  /** Per serving; null when the recipe can't be checked yet. */
  usdaPerServing: Partial<Macros> | null;
  lines: { display: string; result: LineResult }[];
  noServings: boolean;
  /** Every line is matched and weighed, but none of them weighs anything. */
  nothingToCount: boolean;
  /** Lines left out of the total, with why. */
  notCounted: { display: string; reason: "no amount" | "not parsed" }[];
  /** Lines with no amount, counted at their food's default amount. */
  assumed: { display: string; grams: number }[];
  unmatchedFoods: { id: string; name: string }[];
  needsAmount: { display: string; reason: string }[];
};

const round = (macro: MacroKey, value: number) =>
  macro === "kcal" ? Math.round(value) : Math.round(value * 10) / 10;

const sameFigures = (a: Partial<Macros>, b: Partial<Macros>) =>
  MACRO_KEYS.every((k) => a[k] === b[k]);

/**
 * Compares a recipe's nutrition in Mealie with what its ingredients add up to
 * in USDA. `review` is the decision already made, which holds only while the
 * USDA figures are the ones it was made against.
 */
export function checkRecipe(
  recipe: {
    servings: number | null;
    perServing: Partial<Macros>;
    ingredients: Ingredient[];
  },
  matches: Map<string, FoodMatch>,
  review?: { usdaPerServing: Partial<Macros> } | null
): RecipeCheck {
  const lines = recipe.ingredients.map((line) => ({
    display: line.display,
    result: lineResult(line, line.food ? matches.get(line.food.id) : undefined),
  }));

  const unmatched = new Map<string, string>();
  const missingAmount: RecipeCheck["needsAmount"] = [];
  const notCounted: RecipeCheck["notCounted"] = [];
  const assumed: RecipeCheck["assumed"] = [];
  const total: Partial<Macros> = {};
  const unknown = new Set<MacroKey>();
  let grams = 0;
  for (const { display, result } of lines) {
    if (result.kind === "unmatched") {
      unmatched.set(result.foodId, result.foodName);
    } else if (result.kind === "notCounted") {
      notCounted.push({ display, reason: result.reason });
    } else if (result.kind === "needsAmount") {
      missingAmount.push({ display, reason: result.reason });
    } else if (result.kind === "counted") {
      grams += result.grams;
      if (result.assumed) {
        assumed.push({ display, grams: result.grams });
      }
      for (const key of MACRO_KEYS) {
        const value = result.macros[key];
        if (value !== undefined) {
          total[key] = (total[key] ?? 0) + value;
        } else if (result.grams > 0) {
          unknown.add(key);
        }
      }
    }
  }

  // A total of zero would read as "USDA says 0 kcal", and "Use USDA's" would
  // write zeros over the recipe.
  const nothingToCount =
    grams === 0 && unmatched.size === 0 && missingAmount.length === 0;
  const base = {
    mealie: recipe.perServing,
    lines,
    noServings: recipe.servings === null,
    nothingToCount,
    notCounted,
    assumed,
    unmatchedFoods: [...unmatched].map(([id, name]) => ({ id, name })),
    needsAmount: missingAmount,
  };
  const servings = recipe.servings;
  if (
    servings === null ||
    nothingToCount ||
    unmatched.size > 0 ||
    missingAmount.length > 0
  ) {
    return {
      ...base,
      status: "cantCheck",
      outside: [],
      usdaPerServing: null,
    };
  }

  const usdaPerServing: Partial<Macros> = {};
  for (const key of MACRO_KEYS) {
    if (!unknown.has(key)) {
      usdaPerServing[key] = round(key, (total[key] ?? 0) / servings);
    }
  }
  const outside = MACRO_KEYS.filter((key) => {
    const usda = usdaPerServing[key];
    return usda !== undefined && isOutside(key, recipe.perServing[key], usda);
  });
  const status: CheckStatus =
    outside.length === 0
      ? "match"
      : review && sameFigures(review.usdaPerServing, usdaPerServing)
        ? "reviewed"
        : "mismatch";
  return { ...base, status, outside, usdaPerServing };
}

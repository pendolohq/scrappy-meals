import { parseDecimal } from "@/server/domain/decimal";
import {
  defaultPiece,
  type FoodUnit,
  type LineFood,
  servingLabel,
  servingNutrition,
  type ServingNutrition,
} from "@/server/domain/food";
import type { UsdaFood } from "@/server/domain/usda";
import type { FoodCandidate } from "@/server/foods";
import {
  MACRO_KEYS,
  type MacroKey,
  type Macros,
} from "@/server/mealie/nutrition";

/** The Mealie food picked, or a new one named like the food. */
export type Picked = { food: FoodCandidate } | { create: string };

/** Where the serving's nutrition comes from. */
export type Source = { kind: "usda"; food: UsdaFood } | { kind: "own" };

/** The macro fields as typed. */
export type MacroTexts = Record<MacroKey, string>;

export const UNIT_LABELS: Record<FoodUnit, string> = {
  piece: "pieces",
  g: "g",
  ml: "ml",
};

// A sensible first amount when the unit changes.
export const STARTING_AMOUNT: Record<FoodUnit, string> = {
  piece: "1",
  g: "100",
  ml: "200",
};

export const grams = (n: number) => String(Math.round(n * 100) / 100);

export const decimal = (text: string) =>
  text.trim() === "" ? null : parseDecimal(text, "refuse");

export const emptyValues = (): MacroTexts =>
  Object.fromEntries(MACRO_KEYS.map((k) => [k, ""])) as MacroTexts;

/** The food on the recipe's line; a new one has no Mealie id yet. */
export const lineFoodOf = (picked: Picked): LineFood =>
  "food" in picked
    ? picked.food
    : { id: "new", name: picked.create, gramsPerMl: null };

export const isPicked = (picked: Picked | undefined, option: Picked) =>
  picked !== undefined &&
  ("food" in option
    ? "food" in picked && picked.food.id === option.food.id
    : "create" in picked);

/**
 * The piece weight to start from with a USDA food: the one the food already
 * has for it, else USDA's usual piece (with its label, so the picker shows it).
 */
export const startingPiece = (
  food: UsdaFood,
  weight: number | null,
  label: string | null
): { text: string; label: string | null } => {
  const portion = defaultPiece(food.portions);
  const piece = weight ?? portion?.grams ?? null;
  return {
    text: piece === null ? "" : grams(piece),
    label: weight === null ? (portion?.label ?? null) : label,
  };
};

/** The values typed in, and whether any of them isn't a number of 0 or more. */
export const readMacros = (
  texts: MacroTexts
): { values: Partial<Macros>; invalid: boolean } => {
  const values: Partial<Macros> = {};
  let invalid = false;
  for (const key of MACRO_KEYS) {
    const v = decimal(texts[key]);
    if (texts[key].trim() !== "" && (v === null || v < 0)) {
      invalid = true;
    } else if (v !== null) {
      values[key] = v;
    }
  }
  return { values, invalid };
};

export type FoodForm = {
  picked: Picked | undefined;
  source: Source | undefined;
  amount: string;
  unit: FoodUnit;
  pieceText: string;
  values: MacroTexts;
};

export type FormReading = {
  /** Null while the amount isn't a number above 0. */
  serving: { amount: number; unit: FoodUnit } | null;
  /** What one piece weighs, in grams, as typed. */
  piece: number | null;
  /** The piece weight is usable, or the serving isn't in pieces. */
  pieceOk: boolean;
  /** The serving counted from its USDA food; null with nothing to count yet. */
  counted: ServingNutrition | null;
  own: { values: Partial<Macros>; invalid: boolean };
  /** Everything needed to save is there. */
  ready: boolean;
};

/** What the sheet's fields add up to. */
export const readForm = (form: FoodForm): FormReading => {
  const { picked, source, unit } = form;
  const amount = decimal(form.amount);
  const piece = decimal(form.pieceText);
  const pieceOk = unit !== "piece" || (piece !== null && piece > 0);
  const serving = amount !== null && amount > 0 ? { amount, unit } : null;
  const counted =
    source?.kind === "usda" && serving && picked
      ? servingNutrition(serving, lineFoodOf(picked), {
          fdcId: source.food.fdcId,
          status: "confirmed",
          pieceGrams: pieceOk && unit === "piece" ? piece : null,
          unitGrams: {},
          defaultGrams: null,
          food: source.food,
        })
      : null;
  const own = readMacros(form.values);
  const ready =
    picked !== undefined &&
    serving !== null &&
    pieceOk &&
    (source?.kind === "usda"
      ? counted !== null && !("problem" in counted)
      : source?.kind === "own" &&
        !own.invalid &&
        own.values.kcal !== undefined);
  return { serving, piece, pieceOk, counted, own, ready };
};

/** The nutrition to save; null when the values typed in have no calories. */
export const nutritionToSave = (
  source: Source,
  own: Partial<Macros>,
  estimated: boolean
) => {
  if (source.kind === "usda") {
    return { from: "usda", fdcId: source.food.fdcId } as const;
  }
  const { kcal } = own;
  return kcal === undefined
    ? null
    : ({ from: "own", perServing: { ...own, kcal }, estimated } as const);
};

/**
 * What saving changes for every recipe that uses the food, when it has a
 * confirmed match: the USDA food it's matched to, or what one piece weighs.
 */
export const matchWarning = (
  picked: Picked | undefined,
  source: Source | undefined,
  unit: FoodUnit,
  piece: number | null
): string | null => {
  const match = picked && "food" in picked ? picked.food.match : null;
  if (
    !picked ||
    !("food" in picked) ||
    match?.status !== "confirmed" ||
    source?.kind !== "usda"
  ) {
    return null;
  }
  const { name } = picked.food;
  if (source.food.fdcId !== match.fdcId) {
    return `Saving changes the USDA match of ${name} for every recipe that uses it.`;
  }
  if (
    unit === "piece" &&
    match.pieceGrams !== null &&
    piece !== null &&
    piece !== match.pieceGrams
  ) {
    return `Saving changes what one ${name} weighs for every recipe that uses it.`;
  }
  return null;
};

/** The serving as Claude is asked to estimate it: "2 pieces (138 g) Kiwi". */
export const estimateLine = (
  serving: { amount: number; unit: FoodUnit },
  piece: number | null,
  food: LineFood
) => {
  const label = servingLabel({
    ...serving,
    grams: serving.unit === "piece" && piece ? piece * serving.amount : null,
  });
  return `${label} ${food.name}`;
};

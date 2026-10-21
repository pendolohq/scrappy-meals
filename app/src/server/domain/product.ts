import { MACRO_KEYS, type MacroKey, type Macros } from "../mealie/nutrition";

export type ServingUnit = "g" | "ml";

/** What a product recipe carries (in Mealie's extras, and in the cache). */
export type ProductInfo = {
  barcode: string;
  /** One serving is this many grams (or millilitres). */
  servingGrams: number;
  servingUnit: ServingUnit;
  packGrams: number | null;
};

/** The parsed subset of an Open Food Facts product. */
export type OffProduct = {
  name: string | null;
  brand: string | null;
  quantity: string | null;
  productQuantity: number | null;
  productQuantityUnit: string | null;
  servingQuantity: number | null;
  servingQuantityUnit: string | null;
  per100: Partial<Macros>;
  kcalFromKj: boolean;
};

export type ProductDraft = {
  barcode: string;
  /** Empty when Open Food Facts has none: the user has to type one. */
  name: string;
  servingGrams: number;
  servingUnit: ServingUnit;
  packGrams: number | null;
  per100: Partial<Macros>;
  missing: MacroKey[];
  /** The kcal figure was worked out from kJ: the sheet asks to confirm it. */
  kcalFromKj: boolean;
  /** The macros don't add up (see `macrosInconsistent`). */
  inconsistent: boolean;
  sourceUrl: string;
};

export type PortionChoice =
  | { kind: "servings"; count: number }
  | { kind: "pack" }
  | { kind: "grams"; grams: number };

export const offProductUrl = (barcode: string) =>
  `https://world.openfoodfacts.org/product/${barcode}`;

const NAME_MAX = 120;

/**
 * "Grenade Carb Killa": the first brand in front of the name, unless the name
 * already contains one of the brands.
 */
export function productName(
  name: string | null,
  brands: string | null
): string {
  const clean = (name ?? "").replace(/\s+/g, " ").trim();
  if (!clean) {
    return "";
  }
  const list = (brands ?? "")
    .split(",")
    .map((b) => b.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const lower = clean.toLowerCase();
  const full =
    list.length === 0 || list.some((b) => lower.includes(b.toLowerCase()))
      ? clean
      : `${list[0]} ${clean}`;
  return full.slice(0, NAME_MAX);
}

const MULTIPACK = /^\s*(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(g|ml)\s*$/i;

const isUnit = (unit: string | null) =>
  unit === null || unit === "g" || unit === "ml";

/** The pack size in g or ml; null when unknown or in a unit we can't use. */
function packSize(p: OffProduct): number | null {
  return p.productQuantity !== null &&
    p.productQuantity > 0 &&
    isUnit(p.productQuantityUnit)
    ? p.productQuantity
    : null;
}

function guessServing(
  p: OffProduct,
  pack: number | null
): { grams: number; unit: ServingUnit } {
  const unit: ServingUnit =
    p.servingQuantityUnit === "ml" || p.productQuantityUnit === "ml"
      ? "ml"
      : "g";
  if (
    p.servingQuantity !== null &&
    p.servingQuantity > 0 &&
    isUnit(p.servingQuantityUnit) &&
    (pack === null || p.servingQuantity <= pack)
  ) {
    return { grams: p.servingQuantity, unit };
  }
  const multipack = p.quantity ? MULTIPACK.exec(p.quantity) : null;
  if (multipack) {
    return {
      grams: Number(multipack[2].replace(",", ".")),
      unit: multipack[3].toLowerCase() === "ml" ? "ml" : "g",
    };
  }
  if (pack !== null && pack <= 250) {
    return { grams: pack, unit };
  }
  return { grams: 100, unit };
}

/**
 * Whether kcal and the other macros disagree by more than a fifth, going by
 * 4 kcal per g of protein and carbs, 9 of fat and 2 of fibre. Only judged
 * with all four of kcal, protein, carbs and fat; tiny values (a zero drink)
 * are left alone.
 */
export function macrosInconsistent(per100: Partial<Macros>): boolean {
  const { kcal, protein, carbs, fat, fibre } = per100;
  if (
    kcal === undefined ||
    protein === undefined ||
    carbs === undefined ||
    fat === undefined
  ) {
    return false;
  }
  const expected = 4 * protein + 4 * carbs + 9 * fat + 2 * (fibre ?? 0);
  const larger = Math.max(kcal, expected);
  return larger >= 20 && Math.abs(kcal - expected) > 0.2 * larger;
}

export function draftFromOff(
  barcode: string,
  product: OffProduct
): ProductDraft {
  const packGrams = packSize(product);
  const serving = guessServing(product, packGrams);
  return {
    barcode,
    name: productName(product.name, product.brand),
    servingGrams: serving.grams,
    servingUnit: serving.unit,
    packGrams,
    per100: product.per100,
    missing: MACRO_KEYS.filter((k) => product.per100[k] === undefined),
    kcalFromKj: product.kcalFromKj,
    inconsistent: macrosInconsistent(product.per100),
    sourceUrl: offProductUrl(barcode),
  };
}

/** Per-100 values for a serving of `grams`, to one decimal. Absent stays absent. */
export function perServing(
  per100: Partial<Macros>,
  grams: number
): Partial<Macros> {
  const out: Partial<Macros> = {};
  for (const key of MACRO_KEYS) {
    const value = per100[key];
    if (value !== undefined) {
      out[key] = Math.round((value * grams) / 10) / 10;
    }
  }
  return out;
}

export const MIN_SERVINGS = 0.01;
export const MAX_SERVINGS = 100;

/**
 * The base servings a portion choice comes to, to two decimals; null when it
 * is outside 0.01 to 100, or "whole pack" with no pack size.
 */
export function servingsFor(
  choice: PortionChoice,
  info: ProductInfo
): number | null {
  let servings: number;
  if (choice.kind === "servings") {
    servings = choice.count;
  } else if (choice.kind === "grams") {
    servings = choice.grams / info.servingGrams;
  } else if (info.packGrams !== null) {
    servings = info.packGrams / info.servingGrams;
  } else {
    return null;
  }
  const rounded = Math.round(servings * 100) / 100;
  return rounded >= MIN_SERVINGS && rounded <= MAX_SERVINGS ? rounded : null;
}

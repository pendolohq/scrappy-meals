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
  /** The free text ("60 g"); only the contribution check reads it. */
  servingSize: string | null;
  /** `nutrition_data_per`: "100g", "serving", ... */
  nutritionPer: string | null;
  /** Someone marked the pack as having no nutrition table. */
  noNutritionData: boolean;
  /** Any nutrient at all, on any basis (as sold, prepared, per serving). */
  hasNutrients: boolean;
  /** Any nutrient per 100 g as sold, which is what we would add to. */
  hasNutrients100g: boolean;
  per100: Partial<Macros>;
  kcalFromKj: boolean;
  /** The front photo, already checked by `offImageUrl`. */
  imageUrl: string | null;
};

/** Where the draft's serving size came from; only data from the pack is public-worthy. */
export type ServingSource = "off" | "multipack" | "pack" | "default";

export type ProductDraft = {
  barcode: string;
  /** Empty when Open Food Facts has none: the user has to type one. */
  name: string;
  servingGrams: number;
  servingUnit: ServingUnit;
  servingSource: ServingSource;
  packGrams: number | null;
  per100: Partial<Macros>;
  missing: MacroKey[];
  /** The kcal figure was worked out from kJ: the sheet asks to confirm it. */
  kcalFromKj: boolean;
  /** The macros don't add up (see `macrosInconsistent`). */
  inconsistent: boolean;
  sourceUrl: string;
  /** Open Food Facts' front photo; Mealie fetches it when the product is saved. */
  imageUrl: string | null;
};

export type PortionChoice =
  | { kind: "servings"; count: number }
  | { kind: "pack" }
  | { kind: "grams"; grams: number };

export const offProductUrl = (barcode: string) =>
  `https://world.openfoodfacts.org/product/${barcode}`;

const OFF_IMAGE_HOSTS = new Set([
  "images.openfoodfacts.org",
  "static.openfoodfacts.org",
]);

/**
 * The URL when it is a plain https link to Open Food Facts' image hosts, else
 * null. The address ends up in a request Mealie makes, and the browser sends
 * it back to us on save, so only these hosts are accepted.
 */
export function offImageUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" &&
      OFF_IMAGE_HOSTS.has(url.hostname) &&
      url.port === "" &&
      url.username === "" &&
      url.password === ""
      ? url.href
      : null;
  } catch {
    return null;
  }
}

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
): { grams: number; unit: ServingUnit; source: ServingSource } {
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
    return { grams: p.servingQuantity, unit, source: "off" };
  }
  const multipack = p.quantity ? MULTIPACK.exec(p.quantity) : null;
  if (multipack) {
    return {
      grams: Number(multipack[2].replace(",", ".")),
      unit: multipack[3].toLowerCase() === "ml" ? "ml" : "g",
      source: "multipack",
    };
  }
  if (pack !== null && pack <= 250) {
    return { grams: pack, unit, source: "pack" };
  }
  return { grams: 100, unit, source: "default" };
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
    servingSource: serving.source,
    packGrams,
    per100: product.per100,
    missing: MACRO_KEYS.filter((k) => product.per100[k] === undefined),
    kcalFromKj: product.kcalFromKj,
    inconsistent: macrosInconsistent(product.per100),
    sourceUrl: offProductUrl(barcode),
    imageUrl: product.imageUrl,
  };
}

/**
 * Whether the serving size on the sheet is worth sending to Open Food Facts:
 * it came from their data or the pack's multipack text, or a person typed or
 * changed it. A guess from the pack size or the 100 g default is not.
 */
export function servingIsKnown(
  draft: Pick<ProductDraft, "servingGrams" | "servingSource"> | null,
  grams: number
): boolean {
  if (draft === null) {
    return true;
  }
  return (
    draft.servingSource === "off" ||
    draft.servingSource === "multipack" ||
    // The unit alone doesn't count: 100 ml is as much a guess as 100 g.
    draft.servingGrams !== grams
  );
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

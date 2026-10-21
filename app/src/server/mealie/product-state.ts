import { parseBarcode } from "../domain/barcode";
import type { ProductInfo } from "../domain/product";

/**
 * What marks a recipe as a packaged product, kept in the recipe's `extras`
 * (string key/values) next to the import state, so it travels with the recipe.
 */
export const PRODUCT_EXTRAS = {
  barcode: "scrappyProduct",
  servingGrams: "scrappyServingGrams",
  servingUnit: "scrappyServingUnit",
  packGrams: "scrappyPackGrams",
} as const;

const positive = (value: unknown): number | null => {
  const n = typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** The product a recipe stands for; null for an ordinary recipe. */
export function readProductState(
  extras: Record<string, unknown> | null | undefined
): ProductInfo | null {
  const raw = extras?.[PRODUCT_EXTRAS.barcode];
  const barcode = typeof raw === "string" ? parseBarcode(raw) : null;
  const servingGrams = positive(extras?.[PRODUCT_EXTRAS.servingGrams]);
  if (!barcode || servingGrams === null) {
    return null;
  }
  return {
    barcode,
    servingGrams,
    servingUnit: extras?.[PRODUCT_EXTRAS.servingUnit] === "ml" ? "ml" : "g",
    packGrams: positive(extras?.[PRODUCT_EXTRAS.packGrams]),
  };
}

/**
 * The recipe's extras with the product written in. Other keys are kept: a
 * PATCH replaces `extras` as a whole.
 */
export function withProductState(
  extras: Record<string, unknown> | null | undefined,
  info: ProductInfo
): Record<string, string> {
  const next = Object.fromEntries(
    Object.entries(extras ?? {}).filter(
      (e): e is [string, string] => typeof e[1] === "string"
    )
  );
  next[PRODUCT_EXTRAS.barcode] = info.barcode;
  next[PRODUCT_EXTRAS.servingGrams] = String(info.servingGrams);
  next[PRODUCT_EXTRAS.servingUnit] = info.servingUnit;
  if (info.packGrams === null) {
    delete next[PRODUCT_EXTRAS.packGrams];
  } else {
    next[PRODUCT_EXTRAS.packGrams] = String(info.packGrams);
  }
  return next;
}

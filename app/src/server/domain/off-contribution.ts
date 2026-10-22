import type { MacroKey, Macros } from "../mealie/nutrition";

import type { OffProduct, ServingUnit } from "./product";

/**
 * A saved product, as far as Open Food Facts cares: no brand, nothing about
 * who ate it. A null serving or pack size is one nobody confirmed (a guess
 * from the pack, the 100 g default): it stays out of a public database.
 */
export type ContributionProduct = {
  barcode: string;
  name: string;
  servingGrams: number | null;
  servingUnit: ServingUnit;
  packGrams: number | null;
  per100: Partial<Macros>;
};

/** Form fields for Open Food Facts' write API. */
export type OffFields = Record<string, string>;

export const CONTRIBUTION_COMMENT = "Added from Scrappy Meals";

const MACRO_FIELDS: Record<MacroKey, { field: string; unit: string }> = {
  kcal: { field: "nutriment_energy-kcal", unit: "kcal" },
  protein: { field: "nutriment_proteins", unit: "g" },
  carbs: { field: "nutriment_carbohydrates", unit: "g" },
  fat: { field: "nutriment_fat", unit: "g" },
  fibre: { field: "nutriment_fiber", unit: "g" },
};
const MACRO_KEYS = Object.keys(MACRO_FIELDS) as MacroKey[];

// Fields that say nothing on their own: a contribution made of only these has
// nothing to add.
const FRAMING = new Set(["code", "comment", "nutrition_data_per"]);

const amount = (grams: number, unit: ServingUnit) => `${grams} ${unit}`;

/** Everything we know about the product, before comparing with what Open Food Facts has. */
export function offCandidateFields(product: ContributionProduct): OffFields {
  const fields: OffFields = {
    code: product.barcode,
    comment: CONTRIBUTION_COMMENT,
    product_name: product.name,
  };
  if (product.servingGrams !== null) {
    fields.serving_size = amount(product.servingGrams, product.servingUnit);
  }
  if (product.packGrams !== null) {
    fields.quantity = amount(product.packGrams, product.servingUnit);
  }
  for (const key of MACRO_KEYS) {
    const value = product.per100[key];
    if (value !== undefined) {
      fields[MACRO_FIELDS[key].field] = String(value);
      fields[`${MACRO_FIELDS[key].field}_unit`] = MACRO_FIELDS[key].unit;
    }
  }
  if (MACRO_KEYS.some((key) => product.per100[key] !== undefined)) {
    fields.nutrition_data_per = "100g";
  }
  return fields;
}

/**
 * Drops from `fields` whatever Open Food Facts already has. We only fill gaps:
 * without an `add_` prefix a field replaces the value, so one sent for a value
 * that is there (even one that looks wrong) would overwrite it. Null when
 * nothing worth sending is left.
 */
export function remainingFields(
  fields: OffFields,
  current: OffProduct | null
): OffFields | null {
  const result: OffFields = { ...fields };
  if (current) {
    const has: Record<string, boolean> = {
      product_name: current.name !== null,
      quantity: current.quantity !== null || current.productQuantity !== null,
      serving_size:
        current.servingSize !== null || current.servingQuantity !== null,
    };
    for (const [field, present] of Object.entries(has)) {
      if (present) {
        delete result[field];
      }
    }
    for (const key of MACRO_KEYS) {
      if (current.per100[key] !== undefined) {
        delete result[MACRO_FIELDS[key].field];
        delete result[`${MACRO_FIELDS[key].field}_unit`];
      }
    }
    // Macros go in only where they can't clash with what is there: a record
    // with no nutrition at all gets the whole table per 100 g; one already
    // per 100 g gets just its missing values. Any other basis (per serving,
    // prepared, "no nutrition data") is left alone.
    const addAll =
      !current.hasNutrients &&
      !current.noNutritionData &&
      (current.nutritionPer === null || current.nutritionPer === "100g");
    const addMissing =
      !current.noNutritionData &&
      current.hasNutrients100g &&
      current.nutritionPer === "100g";
    if (!addAll && !addMissing) {
      for (const key of MACRO_KEYS) {
        delete result[MACRO_FIELDS[key].field];
        delete result[`${MACRO_FIELDS[key].field}_unit`];
      }
    }
    if (!addAll) {
      delete result.nutrition_data_per;
    }
  }
  return Object.keys(result).some((field) => !FRAMING.has(field))
    ? result
    : null;
}

/**
 * What to send for a saved product: everything when Open Food Facts doesn't
 * know it, otherwise only the fields it has empty. Null when there is nothing
 * to add.
 */
export const offContributionFields = (
  product: ContributionProduct,
  current: OffProduct | null
): OffFields | null => remainingFields(offCandidateFields(product), current);

/**
 * Whether a product Open Food Facts has would gain anything from being filled
 * in: true when any of the name, pack size, serving or macros is empty there.
 */
export const offHasGaps = (current: OffProduct): boolean =>
  offContributionFields(
    {
      barcode: "0",
      name: "x",
      servingGrams: 1,
      servingUnit: "g",
      // A pack size can't be supplied by whoever scans it, so it doesn't count.
      packGrams: null,
      per100: { kcal: 1, protein: 1, carbs: 1, fat: 1, fibre: 1 },
    },
    current
  ) !== null;

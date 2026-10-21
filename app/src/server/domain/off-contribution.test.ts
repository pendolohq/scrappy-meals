import { describe, expect, it } from "vitest";

import {
  offFixtureCode,
  offFixtureText,
  type OffFixture,
} from "../../../test/off-fixtures";
import { lookupOpenFoodFacts } from "../openfoodfacts";

import {
  type ContributionProduct,
  offContributionFields,
  offHasGaps,
  remainingFields,
} from "./off-contribution";
import type { OffProduct } from "./product";

const current = async (fixture: OffFixture): Promise<OffProduct> => {
  const result = await lookupOpenFoodFacts(offFixtureCode(fixture), {
    fetch: async () => new Response(offFixtureText(fixture)),
  });
  if (result.status !== "found") {
    throw new Error("fixture should be found");
  }
  return result.product;
};

const product = (
  over: Partial<ContributionProduct> = {}
): ContributionProduct => ({
  barcode: "5060925291339",
  name: "Chocolate bar",
  servingGrams: 60,
  servingUnit: "g",
  packGrams: 180,
  per100: { kcal: 364, protein: 33.8, carbs: 28.2, fat: 14.8 },
  ...over,
});

describe("offContributionFields", () => {
  it("sends everything we have for a product Open Food Facts doesn't know", () => {
    expect(
      offContributionFields(
        product({
          per100: {
            kcal: 364,
            protein: 33.8,
            carbs: 28.2,
            fat: 14.8,
            fibre: 5,
          },
        }),
        null
      )
    ).toEqual({
      code: "5060925291339",
      comment: "Added from Scrappy Meals",
      product_name: "Chocolate bar",
      quantity: "180 g",
      serving_size: "60 g",
      nutrition_data_per: "100g",
      "nutriment_energy-kcal": "364",
      "nutriment_energy-kcal_unit": "kcal",
      nutriment_proteins: "33.8",
      nutriment_proteins_unit: "g",
      nutriment_carbohydrates: "28.2",
      nutriment_carbohydrates_unit: "g",
      nutriment_fat: "14.8",
      nutriment_fat_unit: "g",
      nutriment_fiber: "5",
      nutriment_fiber_unit: "g",
    });
  });

  it("leaves out the pack size and the macros we don't have", () => {
    const fields = offContributionFields(
      product({ packGrams: null, per100: { kcal: 0 } }),
      null
    );
    expect(fields).not.toHaveProperty("quantity");
    expect(fields).not.toHaveProperty("nutriment_proteins");
    expect(fields).toHaveProperty("nutriment_energy-kcal", "0");
  });

  it("uses ml for a drink", () => {
    expect(
      offContributionFields(
        product({ servingUnit: "ml", packGrams: 330, servingGrams: 330 }),
        null
      )
    ).toMatchObject({ quantity: "330 ml", serving_size: "330 ml" });
  });

  it("sends no per-100 g flag when there are no macros", () => {
    const fields = offContributionFields(product({ per100: {} }), null);
    expect(fields).not.toHaveProperty("nutrition_data_per");
    expect(fields).toHaveProperty("product_name");
  });

  it("never sends brands", () => {
    expect(offContributionFields(product(), null)).not.toHaveProperty("brands");
  });

  it("leaves Huel alone: its nutrition is on another basis (prepared)", async () => {
    expect(
      offContributionFields(product(), await current("huel-prepared-only"))
    ).toBeNull();
  });

  describe("macros and the nutrition basis", () => {
    const empty = async (
      over: Partial<OffProduct> = {}
    ): Promise<OffProduct> => ({
      ...(await current("huel-prepared-only")),
      hasNutrients: false,
      hasNutrients100g: false,
      nutritionPer: null,
      ...over,
    });

    it("gives a record with no nutrition at all the whole table, per 100 g", async () => {
      expect(offContributionFields(product(), await empty())).toEqual({
        code: "5060925291339",
        comment: "Added from Scrappy Meals",
        nutrition_data_per: "100g",
        "nutriment_energy-kcal": "364",
        "nutriment_energy-kcal_unit": "kcal",
        nutriment_proteins: "33.8",
        nutriment_proteins_unit: "g",
        nutriment_carbohydrates: "28.2",
        nutriment_carbohydrates_unit: "g",
        nutriment_fat: "14.8",
        nutriment_fat_unit: "g",
      });
    });

    it("adds only the missing macros, without the basis, to a record already per 100 g", async () => {
      const fields = offContributionFields(
        product({ per100: { kcal: 1, fibre: 4.1 } }),
        await empty({
          hasNutrients: true,
          hasNutrients100g: true,
          nutritionPer: "100g",
          per100: { kcal: 400 },
        })
      );
      expect(fields).toEqual({
        code: "5060925291339",
        comment: "Added from Scrappy Meals",
        nutriment_fiber: "4.1",
        nutriment_fiber_unit: "g",
      });
    });

    it("sends no macros to a record whose nutrition is per serving", async () => {
      const perServing = await empty({
        hasNutrients: true,
        hasNutrients100g: true,
        nutritionPer: "serving",
        per100: { kcal: 400 },
      });
      expect(offContributionFields(product(), perServing)).toBeNull();
    });

    it("sends no macros when the nutrients are only on another basis", async () => {
      expect(
        offContributionFields(
          product(),
          await empty({ hasNutrients: true, nutritionPer: "100g" })
        )
      ).toBeNull();
    });

    it("sends no macros to a per-serving record that only carries an unlisted nutrient", async () => {
      // hasNutrients is about nutrients we can't see, e.g. salt only.
      expect(
        offContributionFields(
          product(),
          await empty({ hasNutrients: false, nutritionPer: "serving" })
        )
      ).toBeNull();
      expect(
        offContributionFields(
          product(),
          await empty({ hasNutrients: false, nutritionPer: "100ml" })
        )
      ).toBeNull();
    });

    it("sends no macros, or a basis, when the pack is marked as having no nutrition data", async () => {
      expect(
        offContributionFields(product(), await empty({ noNutritionData: true }))
      ).toBeNull();
    });
  });

  it("sends neither serving nor pack size that nobody confirmed", () => {
    const fields = offContributionFields(
      product({ servingGrams: null, packGrams: null }),
      null
    );
    expect(fields).not.toHaveProperty("serving_size");
    expect(fields).not.toHaveProperty("quantity");
    expect(fields).toHaveProperty("product_name");
  });

  it("adds only the serving size to Grenade, which has everything else", async () => {
    expect(
      offContributionFields(product(), await current("grenade-multipack"))
    ).toEqual({
      code: "5060925291339",
      comment: "Added from Scrappy Meals",
      serving_size: "60 g",
    });
  });

  it("adds Grenade's fibre when we have it and Open Food Facts doesn't", async () => {
    const fields = offContributionFields(
      product({ per100: { fibre: 4.1 } }),
      await current("grenade-multipack")
    );
    expect(fields).toMatchObject({
      serving_size: "60 g",
      nutriment_fiber: "4.1",
    });
    // Grenade is already per 100 g: the basis is not touched.
    expect(fields).not.toHaveProperty("nutrition_data_per");
  });

  it("has nothing to add to Snickers", async () => {
    expect(
      offContributionFields(
        product({
          per100: { kcal: 400, protein: 9, carbs: 50, fat: 20, fibre: 3 },
        }),
        await current("snickers")
      )
    ).toBeNull();
  });

  it("leaves a value Open Food Facts has under a different number alone", async () => {
    // Snickers' kcal is 481 there; we typed 480.
    expect(
      offContributionFields(
        product({ per100: { kcal: 480 } }),
        await current("snickers")
      )
    ).toBeNull();
  });

  it("fills a blank name and sizes, but not a name that is there", async () => {
    const empty = await current("huel-prepared-only");
    const blank: OffProduct = {
      ...empty,
      name: null,
      quantity: null,
      productQuantity: null,
      servingSize: null,
      servingQuantity: null,
    };
    expect(offContributionFields(product({ per100: {} }), blank)).toMatchObject(
      {
        product_name: "Chocolate bar",
        quantity: "180 g",
        serving_size: "60 g",
      }
    );
    // Either quantity field counts as "has a quantity"; so does either serving field.
    const numbersOnly: OffProduct = {
      ...blank,
      name: "Theirs",
      productQuantity: 180,
      servingQuantity: 60,
    };
    expect(
      offContributionFields(product({ per100: {} }), numbersOnly)
    ).toBeNull();
  });
});

describe("remainingFields", () => {
  it("trims a stored contribution to what Open Food Facts still lacks", async () => {
    const stored = offContributionFields(product(), null)!;
    expect(remainingFields(stored, await current("grenade-multipack"))).toEqual(
      {
        code: "5060925291339",
        comment: "Added from Scrappy Meals",
        serving_size: "60 g",
      }
    );
  });

  it("is null when someone else filled it in meanwhile", async () => {
    const stored = offContributionFields(product(), null)!;
    const full = await current("snickers");
    expect(remainingFields(stored, full)).toBeNull();
  });
});

describe("offHasGaps", () => {
  it("is true for Grenade (no serving), false for Huel (other basis) and Snickers", async () => {
    expect(offHasGaps(await current("huel-prepared-only"))).toBe(false);
    expect(offHasGaps(await current("grenade-multipack"))).toBe(true);
    expect(offHasGaps(await current("snickers"))).toBe(false);
  });

  it("doesn't count a missing pack size, which the scanner can't supply", async () => {
    const noPack: OffProduct = {
      ...(await current("snickers")),
      quantity: null,
      productQuantity: null,
    };
    expect(offHasGaps(noPack)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import {
  defaultPiece,
  foodLine,
  type LineFood,
  piecePortions,
  servingLabel,
  servingNutrition,
} from "./food";
import type { UsdaFood } from "./usda";
import { checkRecipe, type FoodMatch } from "./usda-check";

const kiwiFood: LineFood = { id: "food-kiwi", name: "Kiwi", gramsPerMl: null };

const usdaKiwi: UsdaFood = {
  fdcId: 168153,
  description: "Kiwifruit, green, raw",
  dataType: "SR Legacy",
  // Carbs include fibre, the US way: 11.66 are counted.
  per100g: { kcal: 61, protein: 1.14, carbs: 14.66, fat: 0.52, fibre: 3 },
  portions: [
    { label: "1 cup, sliced", measure: "cup", grams: 180 },
    { label: '1 fruit (2" dia)', measure: "fruit", grams: 69 },
    { label: "1 oz", measure: "oz", grams: 28.35 },
  ],
};

const match = (over: Partial<FoodMatch> = {}): FoodMatch => ({
  fdcId: usdaKiwi.fdcId,
  status: "confirmed",
  pieceGrams: 69,
  unitGrams: {},
  defaultGrams: null,
  food: usdaKiwi,
  ...over,
});

describe("servingLabel", () => {
  it("names pieces with their weight, and grams or millilitres as they are", () => {
    expect(servingLabel({ amount: 1, unit: "piece", grams: 69 })).toBe(
      "1 piece (69 g)"
    );
    expect(servingLabel({ amount: 2, unit: "piece", grams: 138 })).toBe(
      "2 pieces (138 g)"
    );
    expect(servingLabel({ amount: 1.5, unit: "piece", grams: null })).toBe(
      "1.5 pieces"
    );
    expect(servingLabel({ amount: 150, unit: "g", grams: 150 })).toBe("150 g");
    expect(servingLabel({ amount: 180, unit: "ml", grams: 185.4 })).toBe(
      "180 ml"
    );
  });
});

describe("foodLine", () => {
  it("has no unit for pieces, so they count and shop like '2 kiwis'", () => {
    expect(foodLine({ amount: 2, unit: "piece" }, kiwiFood)).toMatchObject({
      quantity: 2,
      unit: null,
      food: kiwiFood,
      display: "2 Kiwi",
    });
  });

  it("uses Mealie's standard gram and millilitre", () => {
    expect(foodLine({ amount: 150, unit: "g" }, kiwiFood).unit).toMatchObject({
      standardUnit: "gram",
      standardQuantity: 1,
    });
    expect(foodLine({ amount: 250, unit: "ml" }, kiwiFood).unit).toMatchObject({
      standardUnit: "milliliter",
      standardQuantity: 1,
    });
  });
});

describe("servingNutrition", () => {
  it("weighs pieces with the match's piece weight, carbs without fibre", () => {
    expect(
      servingNutrition({ amount: 2, unit: "piece" }, kiwiFood, match())
    ).toEqual({
      grams: 138,
      perServing: { kcal: 84, protein: 1.6, carbs: 16.1, fat: 0.7, fibre: 4.1 },
    });
  });

  it("takes grams as they are", () => {
    expect(
      servingNutrition({ amount: 100, unit: "g" }, kiwiFood, match())
    ).toMatchObject({ grams: 100, perServing: { kcal: 61, carbs: 11.7 } });
  });

  it("weighs millilitres with the food's density, else a USDA volume portion", () => {
    const milk = { ...kiwiFood, gramsPerMl: 1.03 };
    expect(
      servingNutrition({ amount: 200, unit: "ml" }, milk, match())
    ).toMatchObject({ grams: 206 });
    // 1 cup (236.6 ml) is 180 g.
    const viaCup = servingNutrition(
      { amount: 236.588_236_5, unit: "ml" },
      kiwiFood,
      match()
    );
    expect(viaCup).toMatchObject({ grams: 180 });
  });

  it("says what is missing instead of guessing", () => {
    expect(
      servingNutrition(
        { amount: 1, unit: "piece" },
        kiwiFood,
        match({ pieceGrams: null })
      )
    ).toEqual({ problem: "no piece weight" });
    const noVolume = { ...usdaKiwi, portions: [] };
    expect(
      servingNutrition(
        { amount: 200, unit: "ml" },
        kiwiFood,
        match({ food: noVolume })
      )
    ).toEqual({ problem: "no volume weight" });
  });

  it("agrees with the USDA check of the recipe it makes", () => {
    const serving = { amount: 2, unit: "piece" } as const;
    const counted = servingNutrition(serving, kiwiFood, match());
    if ("problem" in counted) {
      throw new Error("expected a count");
    }
    const check = checkRecipe(
      {
        servings: 1,
        perServing: counted.perServing,
        ingredients: [foodLine(serving, kiwiFood)],
      },
      new Map([[kiwiFood.id, match()]])
    );
    expect(check.status).toBe("match");
    expect(check.usdaPerServing).toEqual(counted.perServing);
  });
});

describe("piecePortions", () => {
  it("keeps what could be one piece, not volumes or weights", () => {
    expect(piecePortions(usdaKiwi.portions).map((p) => p.measure)).toEqual([
      "fruit",
    ]);
  });
});

describe("defaultPiece", () => {
  it("starts from a medium one when USDA has sizes, else the first piece", () => {
    const banana = [
      { label: "1 cup, sliced", measure: "cup", grams: 150 },
      { label: "1 extra large", measure: "extra large", grams: 152 },
      { label: '1 medium (7" to 7-7/8" long)', measure: "medium", grams: 118 },
    ];
    expect(defaultPiece(banana)?.grams).toBe(118);
    expect(defaultPiece(usdaKiwi.portions)?.measure).toBe("fruit");
    expect(defaultPiece([banana[0]!])).toBeNull();
  });
});

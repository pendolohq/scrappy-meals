import { describe, expect, it } from "vitest";

import { readFoodState, withFoodState } from "./food-state";

const kiwi = {
  foodId: "9571b8a1-bb29-41a6-81f2-9747ca9342c8",
  amount: 1,
  unit: "piece" as const,
  grams: 69,
};

describe("food state", () => {
  it("writes the food into the extras and reads it back, keeping other keys", () => {
    const extras = withFoodState({ scrappyReview: "done", count: 3 }, kiwi);
    expect(extras).toEqual({
      scrappyReview: "done",
      scrappyFood: kiwi.foodId,
      scrappyFoodAmount: "1",
      scrappyFoodUnit: "piece",
      scrappyFoodGrams: "69",
    });
    expect(readFoodState(extras)).toEqual(kiwi);
  });

  it("drops the weight when it isn't known", () => {
    const extras = withFoodState(
      { scrappyFoodGrams: "69" },
      { ...kiwi, unit: "ml", amount: 200, grams: null }
    );
    expect(extras).not.toHaveProperty("scrappyFoodGrams");
    expect(readFoodState(extras)).toMatchObject({ unit: "ml", grams: null });
  });

  it("is null for other recipes and unreadable extras", () => {
    expect(readFoodState(null)).toBeNull();
    expect(readFoodState({ scrappyProduct: "5000159461122" })).toBeNull();
    const extras = withFoodState({}, kiwi);
    expect(readFoodState({ ...extras, scrappyFoodUnit: "cup" })).toBeNull();
    expect(readFoodState({ ...extras, scrappyFoodAmount: "0" })).toBeNull();
    expect(readFoodState({ ...extras, scrappyFood: "" })).toBeNull();
  });
});

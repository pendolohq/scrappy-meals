import { describe, expect, it } from "vitest";

import { normaliseNutrition, parseNutritionValue } from "./nutrition";

describe("parseNutritionValue", () => {
  const grams = ["g", "grams"];

  it.each([
    ["12", 12],
    ["12.5", 12.5],
    ["12,5", 12.5],
    [" 7 g", 7],
    ["7g", 7],
    ["7 Grams", 7],
    ["0", 0],
  ])("reads %j as %d", (raw, expected) => {
    expect(parseNutritionValue(raw, grams)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    "",
    "  ",
    "10-12",
    "about 5",
    "5 mg",
    "-3",
    "n/a",
    "1.2.3",
    "1,200",
    "1.200",
    "1,200 kcal",
  ])("rejects %j instead of guessing", (raw) => {
    expect(parseNutritionValue(raw, grams)).toBeNull();
  });

  it.each([
    ["1,200 kcal", 1200],
    ["1.200 kcal", 1200],
    ["1.200,5", 1200.5],
    ["0,125 kcal", 0.125],
  ])("reads calories %j from either locale as %d", (raw, expected) => {
    expect(
      parseNutritionValue(raw, ["kcal", "cal", "calories"], "thousands")
    ).toBe(expected);
  });

  it("accepts calorie units only for kcal", () => {
    expect(parseNutritionValue("250 kcal", ["kcal", "cal", "calories"])).toBe(
      250
    );
    expect(parseNutritionValue("250 kcal", grams)).toBeNull();
  });
});

describe("normaliseNutrition", () => {
  it("reads a thousands group for calories but not for grams", () => {
    const n = normaliseNutrition({
      calories: "1.200",
      proteinContent: "1,200",
    });
    expect(n.perServing).toEqual({ kcal: 1200 });
    expect(n.missing).toContain("protein");
  });

  it("maps Mealie fields to our macros", () => {
    const n = normaliseNutrition({
      calories: "420",
      proteinContent: "31",
      carbohydrateContent: "40.5",
      fatContent: "12",
      fiberContent: "9",
      sodiumContent: "800",
    });
    expect(n).toEqual({
      perServing: { kcal: 420, protein: 31, carbs: 40.5, fat: 12, fibre: 9 },
      missing: [],
      status: "complete",
    });
  });

  it("flags a partially filled recipe", () => {
    const n = normaliseNutrition({
      calories: "300",
      proteinContent: "",
      fatContent: "10-12",
    });
    expect(n.status).toBe("partial");
    expect(n.perServing).toEqual({ kcal: 300 });
    expect(n.missing).toEqual(["protein", "carbs", "fat", "fibre"]);
  });

  it("flags a recipe with no nutrition at all", () => {
    expect(normaliseNutrition(null).status).toBe("missing");
    expect(normaliseNutrition({}).missing).toHaveLength(5);
  });
});

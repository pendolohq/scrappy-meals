import { describe, expect, it } from "vitest";

import type { RecipeNutrition } from "../mealie/nutrition";

import { type MealForMacros, personDayTotals } from "./macros";

const full: RecipeNutrition = {
  perServing: { kcal: 500, protein: 30, carbs: 50, fat: 20, fibre: 8 },
  missing: [],
  status: "complete",
};
const partial: RecipeNutrition = {
  perServing: { kcal: 200 },
  missing: ["protein", "carbs", "fat", "fibre"],
  status: "partial",
};

const meal = (over: Partial<MealForMacros>): MealForMacros => ({
  nutrition: full,
  recipeName: "Stew",
  baseServings: 1,
  portions: { a: 1, b: 1 },
  ...over,
});

describe("personDayTotals", () => {
  it("scales by base servings and each person's multiplier", () => {
    const meals = [
      meal({ portions: { a: 1.5, b: 1 } }),
      meal({ baseServings: 2, portions: { a: 0.5 } }),
    ];
    expect(personDayTotals(meals, "a").macros).toEqual({
      kcal: 1250,
      protein: 75,
      carbs: 125,
      fat: 50,
      fibre: 20,
    });
    expect(personDayTotals(meals, "b")).toMatchObject({
      macros: { kcal: 500 },
      mealsEaten: 1,
      incomplete: false,
    });
  });

  it("ignores meals a person isn't eating, including their missing nutrition", () => {
    const t = personDayTotals(
      [meal({ nutrition: null, recipeName: "Gone", portions: { a: 0, b: 1 } })],
      "a"
    );
    expect(t).toMatchObject({
      mealsEaten: 0,
      incomplete: false,
      macros: { kcal: 0 },
    });
  });

  it("counts known values only and flags partial or missing recipes", () => {
    const t = personDayTotals(
      [
        meal({}),
        meal({ nutrition: partial, recipeName: "Toast" }),
        meal({ nutrition: null, recipeName: "Gone" }),
      ],
      "a"
    );
    expect(t.macros).toEqual({
      kcal: 700,
      protein: 30,
      carbs: 50,
      fat: 20,
      fibre: 8,
    });
    expect(t.incomplete).toBe(true);
    expect(t.incompleteRecipes).toEqual(["Toast", "Gone"]);
  });

  it("rounds to one decimal without drifting", () => {
    const n: RecipeNutrition = {
      ...full,
      perServing: { kcal: 0.1, protein: 0.1, carbs: 0.1, fat: 0.1, fibre: 0.1 },
    };
    const t = personDayTotals(
      [meal({ nutrition: n }), meal({ nutrition: n }), meal({ nutrition: n })],
      "a"
    );
    expect(t.macros.kcal).toBe(0.3);
  });
});

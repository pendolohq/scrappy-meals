import { describe, expect, it } from "vitest";

import {
  checkEstimate,
  type EstimateReply,
  estimatePrompt,
} from "./nutrition-estimate";

// 4·20 + 4·50 + 9·15 = 415 kcal from the macros.
const reply: EstimateReply = {
  servings: 4,
  kcal: 420,
  protein: 20.04,
  carbs: 50,
  fat: 15,
  fibre: 6.26,
};

describe("checkEstimate", () => {
  it("keeps the recipe's servings and rounds the values", () => {
    expect(checkEstimate({ ...reply, servings: 6 }, 4)).toEqual({
      servings: 4,
      perServing: { kcal: 420, protein: 20, carbs: 50, fat: 15, fibre: 6.3 },
    });
  });

  it("takes the model's servings when the recipe has none", () => {
    expect(checkEstimate({ ...reply, servings: 2.4 }, null)?.servings).toBe(2);
  });

  it.each([
    ["kcal far below the macros", { kcal: 250 }],
    ["kcal far above the macros", { kcal: 700 }],
    ["no kcal", { kcal: 0 }],
    ["too many kcal for one serving", { kcal: 3500, carbs: 700 }],
    ["a negative macro", { fibre: -1 }],
    ["an absurd amount", { fat: 500 }],
    ["not a number", { protein: Number.NaN }],
  ])("refuses %s", (_label, patch) => {
    expect(checkEstimate({ ...reply, ...patch }, 4)).toBeNull();
  });

  it("allows for rounding on small servings", () => {
    // 4·1 + 4·10 + 9·1 = 53; 80 kcal is within the fixed slack.
    expect(
      checkEstimate(
        { servings: 1, kcal: 80, protein: 1, carbs: 10, fat: 1, fibre: 2 },
        1
      )
    ).not.toBeNull();
  });

  it("refuses servings it can't use when the recipe has none", () => {
    expect(checkEstimate({ ...reply, servings: 0 }, null)).toBeNull();
    expect(checkEstimate({ ...reply, servings: 0 }, 4)).not.toBeNull();
  });
});

describe("estimatePrompt", () => {
  it("lists the ingredients and the servings to use", () => {
    const prompt = estimatePrompt({
      name: "Lentil soup",
      servings: 4,
      ingredients: ["200 g lentils", "1 onion"],
    });
    expect(prompt).toContain("Recipe: Lentil soup");
    expect(prompt).toContain("makes 4 servings");
    expect(prompt).toContain("- 200 g lentils\n- 1 onion");
  });

  it("asks for a number of servings when the recipe has none", () => {
    expect(
      estimatePrompt({ name: "Soup", servings: null, ingredients: ["x"] })
    ).toContain("doesn't say how many servings");
  });
});

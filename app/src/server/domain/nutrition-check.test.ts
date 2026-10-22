import { describe, expect, it } from "vitest";

import {
  kcalMatchesMacros,
  nutritionWarnings,
  rescalePerServing,
} from "./nutrition-check";

// 4·30 + 4·50 + 9·20 = 500 kcal from the macros.
const pasta = { kcal: 510, protein: 30, carbs: 50, fat: 20, fibre: 6 };

describe("kcalMatchesMacros", () => {
  it("accepts kcal within a quarter of the macros", () => {
    expect(kcalMatchesMacros(pasta)).toBe(true);
    expect(kcalMatchesMacros({ ...pasta, kcal: 640 })).toBe(true);
  });

  it("refuses kcal far off the macros", () => {
    expect(kcalMatchesMacros({ ...pasta, kcal: 200 })).toBe(false);
    expect(kcalMatchesMacros({ ...pasta, kcal: 900 })).toBe(false);
  });

  it("has nothing to compare without all four", () => {
    expect(kcalMatchesMacros({ kcal: 900, protein: 1 })).toBe(true);
  });
});

describe("nutritionWarnings", () => {
  it("says nothing about a plausible serving", () => {
    expect(nutritionWarnings(pasta)).toEqual([]);
    expect(nutritionWarnings({})).toEqual([]);
  });

  it("flags a serving that looks like the whole dish", () => {
    const whole = { kcal: 2040, protein: 120, carbs: 200, fat: 80 };
    expect(nutritionWarnings(whole)).toEqual([
      expect.stringContaining("whole dish"),
    ]);
  });

  it("flags a serving that looks like 100 g", () => {
    const per100 = { kcal: 130, protein: 5, carbs: 20, fat: 3 };
    expect(nutritionWarnings(per100)).toEqual([
      expect.stringContaining("per 100 g"),
    ]);
  });

  it("flags kcal that don't match the macros, with what they come to", () => {
    expect(nutritionWarnings({ ...pasta, kcal: 250 })).toEqual([
      expect.stringContaining("about 500 kcal"),
    ]);
  });
});

describe("rescalePerServing", () => {
  it("splits the same dish into more or fewer servings", () => {
    expect(rescalePerServing(pasta, 4, 2)).toEqual({
      kcal: 1020,
      protein: 60,
      carbs: 100,
      fat: 40,
      fibre: 12,
    });
    expect(rescalePerServing({ kcal: 500, protein: 25 }, 2, 3)).toEqual({
      kcal: 333,
      protein: 16.7,
    });
  });
});

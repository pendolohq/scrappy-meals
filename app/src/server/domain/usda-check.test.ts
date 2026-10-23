import { describe, expect, it } from "vitest";

import type { Macros } from "../mealie/nutrition";
import type { Ingredient } from "../mealie/recipes";

import type { UsdaFood } from "./usda";
import {
  CHECK_THRESHOLD,
  checkRecipe,
  type FoodMatch,
  isOutside,
  lineResult,
  unitKey,
} from "./usda-check";

const usdaFood = (over: Partial<UsdaFood> = {}): UsdaFood => ({
  fdcId: 1,
  description: "Test food",
  dataType: "SR Legacy",
  per100g: { kcal: 100, protein: 10, carbs: 20, fat: 5, fibre: 2 },
  portions: [],
  ...over,
});

const match = (
  food: UsdaFood,
  over: Partial<Omit<FoodMatch, "food">> = {}
): FoodMatch => ({
  fdcId: food.fdcId,
  status: "confirmed",
  pieceGrams: null,
  unitGrams: {},
  defaultGrams: null,
  food,
  ...over,
});

const GRAM = { standardUnit: "gram", standardQuantity: 1 };
const unit = (
  name: string,
  extra: Partial<NonNullable<Ingredient["unit"]>> = {}
) => ({
  id: `unit-${name}`,
  name,
  abbreviation: "",
  ...extra,
});

const UNITS = {
  g: unit("gram", { abbreviation: "g", ...GRAM }),
  oz: unit("ounce", { standardUnit: "ounce", standardQuantity: 1 }),
  cup: unit("cup", { standardUnit: "cup", standardQuantity: 1 }),
  tbsp: unit("tablespoon", { standardUnit: "tablespoon", standardQuantity: 1 }),
  ml: unit("milliliter", { standardUnit: "milliliter", standardQuantity: 1 }),
};

function line(over: Partial<Ingredient> = {}): Ingredient {
  return {
    quantity: 1,
    food: { id: "food-1", name: "Thing" },
    unit: null,
    note: "",
    display: "1 thing",
    ...over,
  };
}

const grams = (quantity: number | null, u: Ingredient["unit"], extra = {}) =>
  line({ quantity, unit: u, ...extra });

describe("lineResult", () => {
  describe("what is not a food line", () => {
    it("skips a heading", () => {
      expect(
        lineResult(
          line({
            food: null,
            quantity: null,
            display: "",
            title: "For the sauce",
          }),
          undefined
        )
      ).toEqual({ kind: "skipped" });
    });

    it("skips a blank line", () => {
      expect(
        lineResult(line({ food: null, quantity: null, display: "" }), undefined)
      ).toEqual({ kind: "skipped" });
    });

    it("asks for an amount when a line with text has no food", () => {
      expect(
        lineResult(
          line({ food: null, quantity: null, display: "a handful of basil" }),
          undefined
        )
      ).toEqual({ kind: "needsAmount", reason: "not parsed" });
    });
  });

  describe("matches", () => {
    it("reports a food with no match", () => {
      expect(lineResult(grams(100, UNITS.g), undefined)).toEqual({
        kind: "unmatched",
        foodId: "food-1",
        foodName: "Thing",
      });
    });

    it("doesn't count a match that is only suggested", () => {
      const suggested = match(usdaFood(), { status: "suggested" });
      expect(lineResult(grams(100, UNITS.g), suggested)).toMatchObject({
        kind: "unmatched",
        foodId: "food-1",
      });
    });

    it("doesn't need a match for a line with no amount", () => {
      expect(lineResult(grams(null, null), undefined)).toEqual({
        kind: "notCounted",
      });
    });
  });

  describe("no quantity", () => {
    it("counts a negligible food as 0 g (salt, water)", () => {
      const salt = usdaFood({
        per100g: { kcal: 0, protein: 0, carbs: 0, fat: 0, fibre: 0 },
      });
      expect(
        lineResult(line({ quantity: null, display: "salt" }), match(salt))
      ).toEqual({
        kind: "counted",
        grams: 0,
        macros: { kcal: 0, protein: 0, carbs: 0, fat: 0, fibre: 0 },
      });
    });

    it("counts the food's default amount, and says it's assumed", () => {
      expect(
        lineResult(
          line({ quantity: null }),
          match(usdaFood(), { defaultGrams: 10 })
        )
      ).toMatchObject({ kind: "counted", grams: 10, assumed: true });
    });

    it("doesn't use a default for a food that's only suggested", () => {
      expect(
        lineResult(
          line({ quantity: null }),
          match(usdaFood(), { status: "suggested", defaultGrams: 10 })
        )
      ).toEqual({ kind: "notCounted" });
    });

    it("leaves any other food out of the total", () => {
      expect(lineResult(line({ quantity: null }), match(usdaFood()))).toEqual({
        kind: "notCounted",
      });
    });
  });

  describe("weights", () => {
    it("takes a gram amount as it is and scales the macros", () => {
      const result = lineResult(grams(250, UNITS.g), match(usdaFood()));
      expect(result).toEqual({
        kind: "counted",
        grams: 250,
        macros: { kcal: 250, protein: 25, carbs: 50, fat: 12.5, fibre: 5 },
      });
    });

    it("converts ounces", () => {
      const result = lineResult(grams(2, UNITS.oz), match(usdaFood()));
      expect(result).toMatchObject({ kind: "counted" });
      expect(result.kind === "counted" && result.grams).toBeCloseTo(56.7, 1);
    });

    it("leaves out a macro the USDA food doesn't have", () => {
      const noFibre = usdaFood({
        per100g: { kcal: 100, protein: 10, carbs: 20, fat: 5 },
      });
      const result = lineResult(grams(100, UNITS.g), match(noFibre));
      expect(result.kind === "counted" && result.macros).toEqual({
        kcal: 100,
        protein: 10,
        carbs: 20,
        fat: 5,
      });
    });
  });

  describe("volumes", () => {
    const cup136 = usdaFood({
      portions: [
        { label: "1 clove", measure: "clove", grams: 3 },
        { label: "1 cup", measure: "cup", grams: 136 },
      ],
    });

    it("uses the food's grams per ml when Mealie has it", () => {
      const result = lineResult(
        grams(1, UNITS.cup, {
          food: { id: "food-1", name: "Thing", gramsPerMl: 0.5 },
        }),
        match(cup136)
      );
      expect(result.kind === "counted" && result.grams).toBeCloseTo(118.29, 2);
    });

    it("prefers grams per ml to a USDA volume portion", () => {
      const result = lineResult(
        grams(1, UNITS.cup, {
          food: { id: "food-1", name: "Thing", gramsPerMl: 1 },
        }),
        match(cup136)
      );
      expect(result.kind === "counted" && result.grams).toBeCloseTo(236.59, 2);
    });

    it("falls back to USDA's cup portion, in another volume unit", () => {
      const result = lineResult(grams(2, UNITS.tbsp), match(cup136));
      // 2 tbsp = 29.57 ml of a food weighing 136 g per 236.59 ml.
      expect(result.kind === "counted" && result.grams).toBeCloseTo(17.0, 1);
    });

    it("uses the first volume portion, such as 'fl oz' for a drink", () => {
      const cappuccino = usdaFood({
        portions: [
          { label: "1 fl oz", measure: "fl oz", grams: 30 },
          { label: "1 cup", measure: "cup", grams: 240 },
        ],
      });
      const result = lineResult(grams(100, UNITS.ml), match(cappuccino));
      expect(result.kind === "counted" && result.grams).toBeCloseTo(101.44, 1);
    });

    it("needs an amount when nothing gives a weight for the volume", () => {
      const result = lineResult(
        grams(1, UNITS.cup),
        match(
          usdaFood({
            portions: [{ label: "1 clove", measure: "clove", grams: 3 }],
          })
        )
      );
      expect(result).toEqual({
        kind: "needsAmount",
        reason: "no weight for this volume",
      });
    });
  });

  describe("other units", () => {
    const garlic = usdaFood({
      portions: [
        { label: "1 clove", measure: "clove", grams: 3 },
        { label: "1 slice", measure: "slice", grams: 7 },
        { label: "1 cup", measure: "cup", grams: 136 },
      ],
    });

    it("uses the match's own weight for the unit first", () => {
      const result = lineResult(
        grams(2, unit("Cloves")),
        match(garlic, { unitGrams: { clove: 5 } })
      );
      expect(result).toMatchObject({ kind: "counted", grams: 10 });
    });

    it("weighs a unit USDA has no portion for", () => {
      const result = lineResult(
        grams(1, unit("thumb-sized piece")),
        match(garlic, { unitGrams: { "thumb-sized piece": 10 } })
      );
      expect(result).toMatchObject({ kind: "counted", grams: 10 });
    });

    it("keys an Italian unit like its English one", () => {
      expect(unitKey({ name: "spicchi" })).toBe("clove");
      expect(unitKey({ name: " Cloves " })).toBe("clove");
    });

    it("uses the USDA portion for the unit: 3 cloves at 3 g each", () => {
      const result = lineResult(grams(3, unit("clove")), match(garlic));
      expect(result).toMatchObject({ kind: "counted", grams: 9 });
    });

    it.each([
      ["a plural name", unit("cloves")],
      ["capitals and spaces", unit(" Clove ")],
      ["the abbreviation", unit("head of garlic", { abbreviation: "clove" })],
    ])("finds the portion by %s", (_label, u) => {
      expect(lineResult(grams(2, u), match(garlic))).toMatchObject({
        kind: "counted",
        grams: 6,
      });
    });

    it.each([
      ["spicchio", "clove", 3],
      ["fetta", "slice", 7],
    ])("understands the Italian %s as a %s", (italian, _english, each) => {
      expect(lineResult(grams(2, unit(italian)), match(garlic))).toMatchObject({
        kind: "counted",
        grams: 2 * each,
      });
    });

    it("finds a leaf portion for 'leaves' and for the Italian foglie", () => {
      const basil = usdaFood({
        portions: [{ label: "1 leaf", measure: "leaf", grams: 0.5 }],
      });
      expect(lineResult(grams(4, unit("leaves")), match(basil))).toMatchObject({
        kind: "counted",
        grams: 2,
      });
      expect(lineResult(grams(4, unit("foglie")), match(basil))).toMatchObject({
        kind: "counted",
        grams: 2,
      });
    });

    it("needs an amount when USDA has no portion for the unit", () => {
      expect(lineResult(grams(1, unit("can")), match(garlic))).toEqual({
        kind: "needsAmount",
        reason: "no weight for can",
      });
    });

    it("maps the Italian lattina onto a can portion", () => {
      const beans = usdaFood({
        portions: [{ label: "1 can", measure: "can", grams: 400 }],
      });
      expect(lineResult(grams(1, unit("lattina")), match(beans))).toMatchObject(
        {
          kind: "counted",
          grams: 400,
        }
      );
    });
  });

  describe("no unit", () => {
    it("multiplies the quantity by the match's piece weight", () => {
      const kiwi = usdaFood();
      expect(
        lineResult(grams(2, null), match(kiwi, { pieceGrams: 75 }))
      ).toMatchObject({ kind: "counted", grams: 150 });
    });

    it("needs an amount without a piece weight, and doesn't guess from portions", () => {
      const kiwi = usdaFood({
        portions: [{ label: "1 fruit", measure: "fruit", grams: 75 }],
      });
      expect(lineResult(grams(2, null), match(kiwi))).toEqual({
        kind: "needsAmount",
        reason: "no weight for one",
      });
    });
  });
});

describe("isOutside", () => {
  it("has the threshold the issue fixed", () => {
    expect(CHECK_THRESHOLD).toEqual({
      share: 0.1,
      floor: { kcal: 20, grams: 3 },
    });
  });

  it.each([
    // [macro, mealie, usda, outside]
    ["kcal", 100, 100, false],
    ["kcal", 120, 100, false], // floor 20 wins over 10 % (10)
    ["kcal", 121, 100, true],
    ["kcal", 80, 100, false], // below, as well as above
    ["kcal", 79, 100, true],
    ["kcal", 1100, 1000, false], // 10 % (100) wins over the floor
    ["kcal", 1101, 1000, true],
    ["kcal", 899, 1000, true],
    ["protein", 13, 10, false], // floor 3 g wins
    ["protein", 13.5, 10, true],
    ["protein", 7, 10, false],
    ["fat", 110, 100, false], // 10 % (10 g) wins
    ["fat", 111, 100, true],
    ["carbs", 0, 2, false], // tiny values don't trip it
    ["carbs", 0, 4, true],
    ["fibre", 5, 1, true],
    ["fibre", 3.5, 1, false],
  ] as const)(
    "%s: Mealie %d vs USDA %d is outside: %s",
    (macro, mealie, usda, expected) => {
      expect(isOutside(macro, mealie, usda)).toBe(expected);
    }
  );

  it("counts a macro Mealie lacks as outside", () => {
    expect(isOutside("kcal", undefined, 100)).toBe(true);
    expect(isOutside("protein", undefined, 0)).toBe(true);
  });
});

describe("checkRecipe", () => {
  // 200 g of a food at 50 kcal, 2 g protein, 10 g carbs, 1 g fat, 3 g fibre per 100 g.
  const flour = usdaFood({
    per100g: { kcal: 50, protein: 2, carbs: 10, fat: 1, fibre: 3 },
  });
  const flourLine = grams(200, UNITS.g, {
    food: { id: "flour", name: "Flour" },
    display: "200 g flour",
  });
  const matches = new Map([["flour", match(flour)]]);
  const recipe = (over: Partial<Parameters<typeof checkRecipe>[0]> = {}) => ({
    servings: 2,
    perServing: {
      kcal: 50,
      protein: 2,
      carbs: 10,
      fat: 1,
      fibre: 3,
    } as Partial<Macros>,
    ingredients: [flourLine],
    ...over,
  });

  it("sums the lines and divides by the servings", () => {
    const check = checkRecipe(recipe(), matches);
    expect(check.usdaPerServing).toEqual({
      kcal: 50,
      protein: 2,
      carbs: 10,
      fat: 1,
      fibre: 3,
    });
  });

  it("adds several lines together", () => {
    const sugar = usdaFood({
      fdcId: 2,
      per100g: { kcal: 400, protein: 0, carbs: 100, fat: 0, fibre: 0 },
    });
    const check = checkRecipe(
      recipe({
        ingredients: [
          flourLine,
          grams(50, UNITS.g, { food: { id: "sugar", name: "Sugar" } }),
        ],
      }),
      new Map([...matches, ["sugar", match(sugar)]])
    );
    expect(check.usdaPerServing).toMatchObject({ kcal: 150, carbs: 35 });
  });

  it("rounds kcal to the unit and grams to one decimal", () => {
    const check = checkRecipe(recipe({ servings: 3 }), matches);
    expect(check.usdaPerServing).toEqual({
      kcal: 33,
      protein: 1.3,
      carbs: 6.7,
      fat: 0.7,
      fibre: 2,
    });
  });

  it("matches when every macro is within the threshold", () => {
    const check = checkRecipe(
      recipe({
        perServing: { kcal: 60, protein: 2.5, carbs: 12, fat: 1, fibre: 3 },
      }),
      matches
    );
    expect(check).toMatchObject({ status: "match", outside: [] });
  });

  it("is a mismatch listing the macros outside", () => {
    const check = checkRecipe(
      recipe({
        perServing: { kcal: 200, protein: 2, carbs: 40, fat: 1, fibre: 3 },
      }),
      matches
    );
    expect(check).toMatchObject({
      status: "mismatch",
      outside: ["kcal", "carbs"],
    });
  });

  it("treats a macro missing in Mealie as outside", () => {
    const check = checkRecipe(recipe({ perServing: { kcal: 50 } }), matches);
    expect(check.status).toBe("mismatch");
    expect(check.outside).toEqual(["protein", "carbs", "fat", "fibre"]);
  });

  it("doesn't compare a macro the USDA food lacks", () => {
    const noFibre = usdaFood({
      per100g: { kcal: 50, protein: 2, carbs: 10, fat: 1 },
    });
    const check = checkRecipe(
      recipe({
        perServing: { kcal: 50, protein: 2, carbs: 10, fat: 1, fibre: 30 },
      }),
      new Map([["flour", match(noFibre)]])
    );
    expect(check.usdaPerServing).not.toHaveProperty("fibre");
    expect(check).toMatchObject({ status: "match", outside: [] });
  });

  it("keeps Mealie's figures and every line's result for the breakdown", () => {
    const heading = line({
      food: null,
      quantity: null,
      display: "",
      title: "Dough",
    });
    const check = checkRecipe(
      recipe({ ingredients: [heading, flourLine] }),
      matches
    );
    expect(check.mealie).toEqual({
      kcal: 50,
      protein: 2,
      carbs: 10,
      fat: 1,
      fibre: 3,
    });
    expect(check.lines).toEqual([
      { display: "", result: { kind: "skipped" } },
      {
        display: "200 g flour",
        result: expect.objectContaining({ kind: "counted", grams: 200 }),
      },
    ]);
  });

  describe("reviewed", () => {
    const mismatching = recipe({
      perServing: { kcal: 400, protein: 2, carbs: 10, fat: 1, fibre: 3 },
    });
    const today = checkRecipe(mismatching, matches).usdaPerServing!;

    it("is reviewed when the decision was made against today's USDA figures", () => {
      const check = checkRecipe(mismatching, matches, {
        usdaPerServing: today,
      });
      expect(check.status).toBe("reviewed");
      expect(check.outside).toEqual(["kcal"]);
    });

    it("is flagged again when the USDA figures changed since", () => {
      const check = checkRecipe(mismatching, matches, {
        usdaPerServing: { ...today, kcal: 61 },
      });
      expect(check.status).toBe("mismatch");
    });

    it("is flagged again when a match changes the figures", () => {
      const other = usdaFood({ per100g: { ...flour.per100g, kcal: 80 } });
      const check = checkRecipe(
        mismatching,
        new Map([["flour", match(other)]]),
        {
          usdaPerServing: today,
        }
      );
      expect(check.status).toBe("mismatch");
    });

    it("stays a match when the recipe matches, whatever was reviewed", () => {
      const check = checkRecipe(recipe(), matches, { usdaPerServing: today });
      expect(check.status).toBe("match");
    });

    it("ignores a review on a recipe that can't be checked", () => {
      const check = checkRecipe(recipe({ servings: null }), matches, {
        usdaPerServing: today,
      });
      expect(check.status).toBe("cantCheck");
    });
  });

  describe("can't check yet", () => {
    it("says when the recipe has no servings", () => {
      const check = checkRecipe(recipe({ servings: null }), matches);
      expect(check).toMatchObject({
        status: "cantCheck",
        noServings: true,
        usdaPerServing: null,
        unmatchedFoods: [],
        needsAmount: [],
      });
    });

    it("lists a food without a match once, however many lines use it", () => {
      const check = checkRecipe(
        recipe({
          ingredients: [
            flourLine,
            grams(50, UNITS.g, { food: { id: "salt", name: "Salt" } }),
            grams(5, UNITS.g, { food: { id: "salt", name: "Salt" } }),
          ],
        }),
        matches
      );
      expect(check.status).toBe("cantCheck");
      expect(check.unmatchedFoods).toEqual([{ id: "salt", name: "Salt" }]);
      expect(check.usdaPerServing).toBeNull();
    });

    it("lists a food whose match is only suggested", () => {
      const check = checkRecipe(
        recipe(),
        new Map([["flour", match(flour, { status: "suggested" })]])
      );
      expect(check).toMatchObject({
        status: "cantCheck",
        unmatchedFoods: [{ id: "flour", name: "Flour" }],
      });
    });

    it("lists lines that need an amount with their reason", () => {
      const check = checkRecipe(
        recipe({
          ingredients: [
            flourLine,
            grams(2, unit("bunch"), {
              food: { id: "flour", name: "Flour" },
              display: "2 bunches flour",
            }),
            line({ food: null, quantity: null, display: "a handful of basil" }),
          ],
        }),
        matches
      );
      expect(check.status).toBe("cantCheck");
      expect(check.needsAmount).toEqual([
        { display: "2 bunches flour", reason: "no weight for bunch" },
        { display: "a handful of basil", reason: "not parsed" },
      ]);
    });

    it("can't check a recipe with no ingredients", () => {
      const check = checkRecipe(recipe({ ingredients: [] }), matches);
      expect(check).toMatchObject({
        status: "cantCheck",
        nothingToCount: true,
        usdaPerServing: null,
      });
    });

    it("can't check a recipe whose lines all weigh nothing", () => {
      const salt = usdaFood({
        fdcId: 3,
        per100g: { kcal: 0, protein: 0, carbs: 0, fat: 0, fibre: 0 },
      });
      const check = checkRecipe(
        recipe({
          ingredients: [
            grams(null, null, {
              food: { id: "salt", name: "Salt" },
              display: "salt",
            }),
          ],
        }),
        new Map([["salt", match(salt)]])
      );
      expect(check).toMatchObject({
        status: "cantCheck",
        nothingToCount: true,
        usdaPerServing: null,
      });
    });

    it("doesn't say nothing counts while foods are still to match", () => {
      const check = checkRecipe(
        recipe({
          ingredients: [grams(5, UNITS.g, { food: { id: "x", name: "X" } })],
        }),
        matches
      );
      expect(check.nothingToCount).toBe(false);
    });

    it("reports everything missing at once", () => {
      const check = checkRecipe(
        recipe({
          servings: null,
          ingredients: [
            grams(1, UNITS.g, { food: { id: "x", name: "X" } }),
            grams(2, unit("bunch"), {
              food: { id: "flour", name: "Flour" },
              display: "2 bunches flour",
            }),
          ],
        }),
        matches
      );
      expect(check).toMatchObject({
        noServings: true,
        unmatchedFoods: [{ id: "x", name: "X" }],
        needsAmount: [
          { display: "2 bunches flour", reason: "no weight for bunch" },
        ],
      });
    });
  });

  describe("lines with no amount", () => {
    const oil = grams(null, null, {
      food: { id: "oil", name: "Olive oil" },
      display: "olive oil, to drizzle",
    });
    const pepper = grams(null, null, {
      food: { id: "pepper", name: "Black pepper" },
      display: "black pepper, to taste",
    });

    it("checks the recipe without them and lists them", () => {
      const check = checkRecipe(
        recipe({ ingredients: [flourLine, oil, pepper] }),
        matches
      );
      expect(check).toMatchObject({
        status: "match",
        notCounted: ["olive oil, to drizzle", "black pepper, to taste"],
        unmatchedFoods: [],
      });
      expect(check.usdaPerServing).toEqual(
        checkRecipe(recipe(), matches).usdaPerServing
      );
    });

    it("counts and lists a line at its food's default amount", () => {
      const check = checkRecipe(
        recipe({ ingredients: [flourLine, oil] }),
        new Map([...matches, ["oil", match(flour, { defaultGrams: 10 })]])
      );
      expect(check.assumed).toEqual([
        { display: "olive oil, to drizzle", grams: 10 },
      ]);
      expect(check.notCounted).toEqual([]);
      // 210 g at 50 kcal per 100 g, over 2 servings.
      expect(check.usdaPerServing?.kcal).toBe(53);
    });

    it("can't check a recipe that has nothing but them", () => {
      const check = checkRecipe(recipe({ ingredients: [oil] }), matches);
      expect(check).toMatchObject({
        status: "cantCheck",
        nothingToCount: true,
        notCounted: ["olive oil, to drizzle"],
      });
    });
  });
});

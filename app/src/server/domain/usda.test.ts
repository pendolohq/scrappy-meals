import { describe, expect, it } from "vitest";

import foodsJson from "../usda/fixtures/foods.json";
import searchJson from "../usda/fixtures/search.json";

import { isNegligible, parseFoodDetails, parseSearch } from "./usda";

// Trimmed real FoodData Central responses (see docs/plans/usda-nutrition-check.md).
const foods = parseFoodDetails(foodsJson);
const food = (fdcId: number) => {
  const found = foods.find((f) => f.fdcId === fdcId);
  if (!found) {
    throw new Error(`fixture ${fdcId} missing`);
  }
  return found;
};

/** A minimal details response with just the nutrients given as [id, amount]. */
const detail = (nutrients: [number, number][], portions: unknown[] = []) => [
  {
    fdcId: 1,
    description: "Thing",
    dataType: "SR Legacy",
    foodNutrients: nutrients.map(([id, amount]) => ({
      nutrient: { id, name: "n", unitName: "g" },
      amount,
    })),
    foodPortions: portions,
  },
];

describe("parseSearch", () => {
  const hits = parseSearch(searchJson);

  it("reads each hit's identity and category", () => {
    expect(hits).toHaveLength(5);
    expect(hits.find((h) => h.fdcId === 2709239)).toMatchObject({
      description: "Kiwi fruit, raw",
      dataType: "Survey (FNDDS)",
      foodCategory: "Other fruits and fruit salads",
    });
  });

  it("reads the macros per 100 g", () => {
    expect(hits.find((h) => h.fdcId === 2709239)?.per100g).toEqual({
      kcal: 64,
      protein: 1.06,
      carbs: 14,
      fat: 0.44,
      fibre: 3,
    });
  });

  it("takes kcal from Atwater General when a Foundation food has no Energy", () => {
    expect(hits.find((h) => h.fdcId === 2710831)?.per100g.kcal).toBe(65.1);
  });

  it("takes kcal from Energy, never from the kJ nutrient", () => {
    expect(hits.find((h) => h.fdcId === 174111)?.per100g.kcal).toBe(47);
  });

  it.each([[null], [{}], ["nope"], [{ foods: "x" }]])(
    "returns no hits for %j",
    (json) => {
      expect(parseSearch(json)).toEqual([]);
    }
  );

  it("reads a missing category as null", () => {
    const [hit] = parseSearch({
      foods: [
        {
          fdcId: 5,
          description: "X",
          dataType: "Foundation",
          foodNutrients: [],
        },
      ],
    });
    expect(hit).toMatchObject({ fdcId: 5, foodCategory: null, per100g: {} });
  });
});

describe("parseFoodDetails nutrients", () => {
  it("reads all five macros from SR Legacy", () => {
    expect(food(168153).per100g).toEqual({
      kcal: 61,
      protein: 1.14,
      carbs: 14.66,
      fat: 0.52,
      fibre: 3,
    });
  });

  it("falls back to Atwater General for kcal on Foundation foods", () => {
    expect(food(2710831).per100g.kcal).toBeCloseTo(65.0648, 4);
  });

  it("prefers Atwater General to Atwater Specific", () => {
    const [f] = parseFoodDetails(
      detail([
        [2048, 50],
        [2047, 60],
      ])
    );
    expect(f?.per100g.kcal).toBe(60);
  });

  it("uses Atwater Specific when General is absent", () => {
    const [f] = parseFoodDetails(detail([[2048, 50]]));
    expect(f?.per100g.kcal).toBe(50);
  });

  it("prefers Energy to the Atwater figures", () => {
    const [f] = parseFoodDetails(
      detail([
        [2047, 60],
        [1008, 55],
      ])
    );
    expect(f?.per100g.kcal).toBe(55);
  });

  it("takes carbohydrate by difference, which includes fibre", () => {
    const [f] = parseFoodDetails(
      detail([
        [1005, 12],
        [1050, 10],
      ])
    );
    expect(f?.per100g.carbs).toBe(12);
  });

  it("falls back to carbohydrate by summation", () => {
    const [f] = parseFoodDetails(detail([[1050, 10]]));
    expect(f?.per100g.carbs).toBe(10);
  });

  it("leaves out a macro the food doesn't report, and keeps a real zero", () => {
    const [f] = parseFoodDetails(
      detail([
        [1003, 0],
        [1004, 2],
      ])
    );
    expect(f?.per100g).toEqual({ protein: 0, fat: 2 });
    expect(f?.per100g).not.toHaveProperty("kcal");
  });

  it("reads zero fibre from FNDDS", () => {
    expect(food(2710472).per100g.fibre).toBe(0);
  });

  it("reads identity and returns every food in the response", () => {
    expect(foods.map((f) => f.fdcId)).toEqual([
      2710831, 168153, 2709239, 2710472, 171705, 169230, 748967,
    ]);
    expect(food(748967)).toMatchObject({
      description: "Eggs, Grade A, Large, egg whole",
      dataType: "Foundation",
    });
  });

  it.each([[null], [{}], ["nope"]])("returns no foods for %j", (json) => {
    expect(parseFoodDetails(json)).toEqual([]);
  });
});

describe("parseFoodDetails portions", () => {
  const find = (fdcId: number, measure: string) =>
    food(fdcId).portions.find((p) => p.measure === measure);

  it("drops a RACC serving, leaving a Foundation kiwi without portions", () => {
    expect(food(2710831).portions).toEqual([]);
  });

  it("keeps a real Foundation portion and drops its RACC", () => {
    expect(food(748967).portions).toEqual([
      expect.objectContaining({ measure: "egg", grams: 50.3 }),
    ]);
  });

  it("reads SR Legacy modifiers as one measure, dropping size notes and NLEA", () => {
    expect(find(168153, "fruit")?.grams).toBe(69);
    expect(find(168153, "cup")?.grams).toBe(180);
    expect(food(168153).portions).toHaveLength(2);
    expect(
      food(171705).portions.some((p) => p.label.toLowerCase().includes("nlea"))
    ).toBe(false);
  });

  it("gives the weight of ONE measure: '3 cloves' at 9 g is a clove of 3 g", () => {
    const cloves = food(169230).portions.filter((p) => p.measure === "clove");
    expect(cloves.map((p) => p.grams)).toEqual([3, 3]);
    expect(find(169230, "cup")?.grams).toBe(136);
  });

  it("reads FNDDS descriptions, with the leading count removed", () => {
    expect(find(2709239, "fruit")?.grams).toBe(75);
    expect(find(2709239, "slice")?.grams).toBe(7);
    expect(find(2709239, "cup")?.grams).toBe(180);
  });

  it("drops 'Quantity not specified'", () => {
    expect(food(2709239).portions).toHaveLength(3);
    expect(
      food(2710472).portions.some((p) => /not specified/i.test(p.label))
    ).toBe(false);
  });

  it("reads 'fl oz' and size words as measures", () => {
    expect(find(2710472, "fl oz")?.grams).toBe(30);
    expect(find(2710472, "cup")?.grams).toBe(240);
    expect(find(2710472, "small")?.grams).toBe(360);
    expect(find(2710472, "large")?.grams).toBe(600);
  });

  it("keeps a readable label for the picker", () => {
    expect(find(2709239, "cup")?.label).toBe("1 cup");
  });
});

describe("isNegligible", () => {
  it.each([
    ["salt", { kcal: 0, protein: 0, carbs: 0, fat: 0, fibre: 0 }, true],
    ["water", { kcal: 0, protein: 0, carbs: 0, fat: 0 }, true],
    [
      "right at the limits",
      { kcal: 5, protein: 0.5, carbs: 0.5, fat: 0.5, fibre: 0.5 },
      true,
    ],
    ["6 kcal", { kcal: 6, protein: 0, carbs: 0, fat: 0 }, false],
    ["0.6 g fat", { kcal: 0, protein: 0, carbs: 0, fat: 0.6 }, false],
    ["0.6 g carbs", { kcal: 0, protein: 0, carbs: 0.6, fat: 0 }, false],
    [
      "0.6 g fibre",
      { kcal: 0, protein: 0, carbs: 0, fat: 0, fibre: 0.6 },
      false,
    ],
    ["no figures at all", {}, false],
  ])("%s", (_label, per100g, expected) => {
    expect(isNegligible(per100g)).toBe(expected);
  });
});

import { describe, expect, it } from "vitest";

import type { Ingredient } from "../mealie/recipes";

import {
  plannedServings,
  scaleIngredients,
  servingsScale,
  stepIngredients,
  unitLabel,
} from "./ingredients";
import { buildShoppingList } from "./shopping";

const gram = { id: "u-g", name: "gram", abbreviation: "g" };
const ing = (over: Partial<Ingredient> = {}): Ingredient => ({
  quantity: null,
  food: null,
  unit: null,
  note: "",
  display: "",
  ...over,
});
const lentils = ing({
  quantity: 400,
  food: { id: "f-lentils", name: "red lentils" },
  unit: gram,
  display: "400 g red lentils",
});
const onions = ing({
  quantity: 1,
  food: { id: "f-onion", name: "onion" },
  note: "chopped",
  display: "1 onion chopped",
});
const lemon = ing({
  note: "a squeeze of lemon",
  display: "a squeeze of lemon",
});
const salt = ing({
  food: { id: "f-salt", name: "salt" },
  display: "salt to taste",
});

describe("plannedServings", () => {
  it("is base servings times everyone's portions", () => {
    expect(plannedServings(1, { a: 1, b: 0.5 })).toBe(1.5);
    expect(plannedServings(2, { a: 1, b: 1.5 })).toBe(5);
  });

  it("is 0 when nobody eats it", () => {
    expect(plannedServings(1, { a: 0, b: 0 })).toBe(0);
    expect(plannedServings(1, {})).toBe(0);
  });
});

describe("servingsScale", () => {
  it("is null without a servings count", () => {
    expect(servingsScale(null, 2)).toBeNull();
  });

  it("works with fractional servings on either side", () => {
    expect(servingsScale(2.5, 5)).toBe(2);
    expect(servingsScale(4, 1.5)).toBe(0.375);
  });
});

describe("unitLabel", () => {
  it("prefers the abbreviation", () => {
    expect(unitLabel(gram)).toBe("g");
    expect(unitLabel({ id: "u", name: "pinch", abbreviation: "" })).toBe(
      "pinch"
    );
    expect(unitLabel(null)).toBeNull();
  });
});

describe("scaleIngredients", () => {
  it("scales parsed lines to the servings asked for", () => {
    expect(scaleIngredients([lentils, onions], 4, 6)).toEqual([
      {
        title: null,
        scaled: { quantity: 600, unit: "g", food: "red lentils", note: "" },
        text: "400 g red lentils",
        referenceId: null,
      },
      {
        title: null,
        scaled: { quantity: 1.5, unit: null, food: "onion", note: "chopped" },
        text: "1 onion chopped",
        referenceId: null,
      },
    ]);
  });

  it("rounds to two decimals, with fractional servings", () => {
    const [line] = scaleIngredients([lentils], 3, 1.5);
    expect(line.scaled?.quantity).toBe(200);
    const [third] = scaleIngredients([onions], 3, 1);
    expect(third.scaled?.quantity).toBe(0.33);
  });

  it("gives 0 when cooking for nobody, and still scales back up", () => {
    expect(scaleIngredients([lentils], 4, 0)[0].scaled?.quantity).toBe(0);
    expect(scaleIngredients([lentils], 4, 1)[0].scaled?.quantity).toBe(100);
  });

  it("shows lines without a food or an amount as written", () => {
    expect(scaleIngredients([lemon, salt], 4, 8)).toEqual([
      {
        title: null,
        scaled: null,
        text: "a squeeze of lemon",
        referenceId: null,
      },
      { title: null, scaled: null, text: "salt to taste", referenceId: null },
    ]);
  });

  it("shows every line as written when the recipe has no servings count", () => {
    expect(scaleIngredients([lentils, lemon], null, 8)).toEqual([
      {
        title: null,
        scaled: null,
        text: "400 g red lentils",
        referenceId: null,
      },
      {
        title: null,
        scaled: null,
        text: "a squeeze of lemon",
        referenceId: null,
      },
    ]);
  });

  it("keeps section headings and drops empty lines", () => {
    expect(
      scaleIngredients(
        [
          { ...lentils, title: "Soup" },
          ing(),
          ing({ title: "To serve" }),
          lemon,
        ],
        4,
        4
      ).map((l) => [l.title, l.text])
    ).toEqual([
      ["Soup", "400 g red lentils"],
      ["To serve", ""],
      [null, "a squeeze of lemon"],
    ]);
  });

  it("matches the shopping list at the planned servings", () => {
    const portions = { a: 1, b: 0.5 };
    const recipe = {
      id: "r1",
      name: "Soup",
      servings: 4,
      ingredients: [lentils, onions],
    };
    const shopping = buildShoppingList([
      { recipe, slug: "soup", baseServings: 1, portions },
    ]);
    const page = scaleIngredients(
      recipe.ingredients,
      recipe.servings,
      plannedServings(1, portions)
    );
    expect(page.map((l) => [l.scaled?.quantity, l.scaled?.unit])).toEqual(
      ["red lentils", "onion"].map((food) => {
        const line = shopping.lines.find((l) => l.foodName === food);
        return [line?.quantity, line?.unit];
      })
    );
  });
});

describe("stepIngredients", () => {
  const linked = [
    { ...lentils, referenceId: "ref-lentils", title: "Soup" },
    { ...onions, referenceId: "ref-onions" },
    ing({ title: "To serve", referenceId: "ref-heading" }),
    { ...lemon, referenceId: "ref-lemon" },
    salt,
  ];

  it("gives a step's linked lines in the list's order, at the same servings", () => {
    const lines = scaleIngredients(linked, 4, 2);
    expect(
      stepIngredients(lines, ["ref-lemon", "ref-lentils"]).map((l) => [
        l.scaled?.quantity ?? null,
        l.text,
      ])
    ).toEqual([
      [200, "400 g red lentils"],
      [null, "a squeeze of lemon"],
    ]);
  });

  it("leaves out section headings, on their own or above a linked line", () => {
    const lines = scaleIngredients(linked, 4, 4);
    expect(stepIngredients(lines, ["ref-lentils", "ref-heading"])).toEqual([
      expect.objectContaining({ title: null, text: "400 g red lentils" }),
    ]);
  });

  it("skips links to ingredients that are gone", () => {
    const lines = scaleIngredients(linked, 4, 4);
    expect(
      stepIngredients(lines, ["ref-deleted", "ref-onions"]).map((l) => l.text)
    ).toEqual(["1 onion chopped"]);
  });

  it("is empty for a step without links, or a recipe cached before links", () => {
    const lines = scaleIngredients(linked, 4, 4);
    expect(stepIngredients(lines, [])).toEqual([]);
    expect(stepIngredients(lines, undefined)).toEqual([]);
    expect(
      stepIngredients(scaleIngredients([lentils, salt], 4, 4), ["ref-lentils"])
    ).toEqual([]);
  });
});

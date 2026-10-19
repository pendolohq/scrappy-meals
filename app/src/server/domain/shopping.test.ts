import { describe, expect, it } from "vitest";

import type { Ingredient } from "../mealie/recipes";
import { buildShoppingList, type MealForShopping } from "./shopping";

const g = { id: "u-g", name: "gram", abbreviation: "g" };
const cup = { id: "u-cup", name: "cup", abbreviation: "" };
const lentils = { id: "f-lentils", name: "lentils" };
const onion = { id: "f-onion", name: "onion" };
const salt = { id: "f-salt", name: "salt" };

const ing = (over: Partial<Ingredient>): Ingredient => ({
  referenceId: "r",
  quantity: null,
  food: null,
  unit: null,
  note: "",
  display: "",
  title: null,
  ...over,
});

const soup = {
  id: "soup",
  name: "Soup",
  servings: 4,
  ingredients: [
    ing({ quantity: 400, food: lentils, unit: g }),
    ing({ quantity: 2, food: onion }),
    ing({ food: salt, display: "salt to taste" }),
    ing({ display: "a handful of parsley" }),
  ],
};
const dal = {
  id: "dal",
  name: "Dal",
  servings: 2,
  ingredients: [
    ing({ quantity: 150, food: lentils, unit: g }),
    ing({ quantity: 1, food: lentils, unit: cup }),
  ],
};

const meal = (
  recipe: MealForShopping["recipe"],
  portions: Record<string, number>,
  baseServings = 1,
): MealForShopping => ({
  recipe,
  slug: recipe?.id ?? "gone",
  baseServings,
  portions,
});

describe("buildShoppingList", () => {
  it("scales by everyone's servings and merges the same food and unit across recipes", () => {
    // Soup: 1.5 + 0.5 = 2 of 4 servings -> half. Dal: 1 of 2 servings -> half.
    const list = buildShoppingList([
      meal(soup, { a: 1.5, b: 0.5 }),
      meal(dal, { a: 1, b: 0 }),
    ]);
    expect(list.lines.map((l) => [l.foodName, l.unit, l.quantity])).toEqual([
      ["lentils", "cup", 0.5],
      ["lentils", "g", 275], // 200 + 75
      ["onion", null, 1],
      ["salt", null, null],
    ]);
    expect(
      list.lines
        .find((l) => l.key === "f-lentils|u-g")
        ?.recipes.map((r) => r.name),
    ).toEqual(["Soup", "Dal"]);
    expect(list.freeText).toEqual([
      {
        text: "a handful of parsley",
        recipeId: "soup",
        recipeName: "Soup",
        times: 1,
      },
    ]);
  });

  it("uses base servings and adds up repeated meals", () => {
    const list = buildShoppingList([
      meal(soup, { a: 1 }, 2),
      meal(soup, { a: 1, b: 1 }),
    ]);
    expect(list.lines.find((l) => l.foodName === "lentils")?.quantity).toBe(
      400,
    ); // (2 + 2) of 4
  });

  it("skips meals nobody eats", () => {
    expect(buildShoppingList([meal(soup, { a: 0, b: 0 })]).lines).toEqual([]);
  });

  it("lists a recipe without servings unscaled, as free text, instead of guessing", () => {
    const toast = {
      id: "toast",
      name: "Toast",
      servings: null,
      ingredients: [
        ing({ quantity: 2, food: onion, display: "2 slices bread" }),
      ],
    };
    const list = buildShoppingList([meal(toast, { a: 1 })]);
    expect(list.lines).toEqual([]);
    expect(list.unscaled).toEqual(["Toast"]);
    expect(list.freeText).toEqual([
      {
        text: "2 slices bread (whole recipe)",
        times: 1,
        recipeId: "toast",
        recipeName: "Toast",
      },
    ]);
  });

  it("reports recipes that are gone from Mealie", () => {
    expect(buildShoppingList([meal(null, { a: 1 })]).missing).toEqual(["gone"]);
  });
});

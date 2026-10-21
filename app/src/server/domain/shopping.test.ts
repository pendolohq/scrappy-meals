import { describe, expect, it } from "vitest";

import type { Ingredient } from "../mealie/recipes";

import {
  buildShoppingList,
  formatAmounts,
  type MealForShopping,
  type ShoppingAmount,
  stillNeeded,
  type WeekIngredients,
} from "./shopping";

const unit = (
  id: string,
  abbreviation: string,
  standardQuantity: number | null = null,
  standardUnit: string | null = null
) => ({ id, name: id, abbreviation, standardQuantity, standardUnit });
const g = unit("u-g", "g", 1, "gram");
const kg = unit("u-kg", "kg", 1, "kilogram");
const cup = unit("u-cup", "", 1, "cup");
const tbsp = unit("u-tbsp", "tbsp", 0.5, "fluid_ounce");
const tsp = unit("u-tsp", "tsp", 1 / 6, "fluid_ounce");
const bunch = unit("u-bunch", "bunch");
const lentils = { id: "f-lentils", name: "lentils", label: "Grains" };
const onion = { id: "f-onion", name: "onion", label: "Fresh Produce" };
const salt = { id: "f-salt", name: "salt", label: "Spices" };

const ing = (over: Partial<Ingredient>): Ingredient => ({
  quantity: null,
  food: null,
  unit: null,
  note: "",
  display: "",
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
  baseServings = 1
): MealForShopping => ({
  recipe,
  slug: recipe?.id ?? "gone",
  baseServings,
  portions,
});

const recipe = (
  id: string,
  ingredients: Ingredient[],
  servings = 1
): NonNullable<MealForShopping["recipe"]> => ({
  id,
  name: id,
  servings,
  ingredients,
});

/** Each line as "food: amounts". */
const read = (list: WeekIngredients) =>
  list.lines.map((l) => `${l.foodName}: ${formatAmounts(l.amounts)}`);

describe("buildShoppingList", () => {
  it("scales by everyone's servings and merges a food across recipes and units", () => {
    // Soup: 1.5 + 0.5 = 2 of 4 servings -> half. Dal: 1 of 2 servings -> half.
    const list = buildShoppingList([
      meal(soup, { a: 1.5, b: 0.5 }),
      meal(dal, { a: 1, b: 0 }),
    ]);
    // Lentils: 200 g + 75 g, up to the next 10, and half a cup (118.3 ml)
    // with no density to weigh it.
    expect(read(list)).toEqual([
      "onion: 1",
      "lentils: 280 g + 120 ml",
      "salt: ",
    ]);
    expect(
      list.lines.find((l) => l.key === "f-lentils")?.recipes.map((r) => r.name)
    ).toEqual(["Soup", "Dal"]);
    expect(list.freeText).toEqual([
      {
        key: "soup|a handful of parsley",
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
    expect(
      list.lines.find((l) => l.foodName === "lentils")?.amounts
    ).toMatchObject([{ quantity: 400, unit: "g" }]); // (2 + 2) of 4
  });

  it("adds up weights in grams and volumes in millilitres", () => {
    const spinach = { id: "f-spinach", name: "spinach" };
    const oil = { id: "f-oil", name: "oil" };
    const list = buildShoppingList([
      meal(
        recipe("a", [
          ing({ quantity: 200, food: spinach, unit: g }),
          ing({ quantity: 1, food: oil, unit: tbsp }),
        ]),
        { a: 1 }
      ),
      meal(
        recipe("b", [
          ing({ quantity: 0.5, food: spinach, unit: kg }),
          ing({ quantity: 2, food: oil, unit: tsp }),
        ]),
        { a: 1 }
      ),
    ]);
    // 14.79 ml + 9.86 ml
    expect(read(list)).toEqual(["oil: 25 ml", "spinach: 700 g"]);
  });

  it("weighs volumes of a food with a density", () => {
    const flour = { id: "f-flour", name: "flour", gramsPerMl: 0.53 };
    const list = buildShoppingList([
      meal(
        recipe("a", [
          ing({ quantity: 1, food: flour, unit: cup }),
          ing({ quantity: 50, food: flour, unit: g }),
        ]),
        { a: 1 }
      ),
    ]);
    expect(read(list)).toEqual(["flour: 180 g"]); // 125.4 g + 50 g
  });

  it("keeps amounts that don't add up on one line", () => {
    const parsley = { id: "f-parsley", name: "parsley" };
    const list = buildShoppingList([
      meal(recipe("a", [ing({ quantity: 100, food: parsley, unit: g })]), {
        a: 1,
      }),
      meal(
        recipe("b", [
          ing({ quantity: 1, food: parsley, unit: bunch }),
          ing({ quantity: 2, food: parsley }),
        ]),
        { a: 1 }
      ),
    ]);
    expect(read(list)).toEqual(["parsley: 100 g + 2 + 1 bunch"]);
  });

  it("rounds counts and grams up only once they're summed", () => {
    const pepper = { id: "f-pepper", name: "pepper" };
    const cans = unit("u-can", "can");
    const tomatoes = { id: "f-tomatoes", name: "tomatoes" };
    const half = recipe("half", [
      ing({ quantity: 0.5, food: onion }),
      ing({ quantity: 0.3, food: pepper, unit: g }),
      ing({ quantity: 0.7, food: tomatoes, unit: cans }),
    ]);
    const list = buildShoppingList([
      meal(half, { a: 1 }),
      meal(half, { a: 1 }),
      meal(half, { a: 1 }),
    ]);
    // 1.5 onions, 0.9 g, 2.1 cans.
    expect(read(list)).toEqual(["onion: 2", "pepper: 1 g", "tomatoes: 3 can"]);
  });

  it("orders lines by aisle, then by name, with unlabelled foods last", () => {
    const list = buildShoppingList([
      meal(
        recipe("a", [
          ing({ quantity: 1, food: { id: "f-x", name: "apple" } }),
          ing({ quantity: 1, food: salt }),
          ing({ quantity: 1, food: onion }),
          ing({ quantity: 1, food: { ...lentils, label: "Health Foods" } }),
          ing({
            quantity: 1,
            food: { id: "f-y", name: "carrot", label: "fresh produce" },
          }),
        ]),
        { a: 1 }
      ),
    ]);
    expect(list.lines.map((l) => [l.aisle, l.foodName])).toEqual([
      ["Fruit & veg", "carrot"],
      ["Fruit & veg", "onion"],
      ["Dairy, eggs & tofu", "lentils"],
      ["Spices, oils & condiments", "salt"],
      ["Other", "apple"],
    ]);
  });

  it("takes a food's label from any recipe that has one", () => {
    // A recipe cached before labels were kept has none.
    const list = buildShoppingList([
      meal(
        recipe("old", [
          ing({ quantity: 1, food: { id: "f-onion", name: "onion" } }),
        ]),
        { a: 1 }
      ),
      meal(recipe("new", [ing({ quantity: 1, food: onion })]), { a: 1 }),
    ]);
    expect(list.lines).toMatchObject([{ aisle: "Fruit & veg" }]);
  });

  it("sums weights in grams", () => {
    const rice = { id: "f-rice", name: "rice" };
    const list = buildShoppingList([
      meal(recipe("a", [ing({ quantity: 1, food: rice, unit: kg })]), { a: 1 }),
      meal(recipe("b", [ing({ quantity: 5, food: rice, unit: g })]), { a: 1 }),
    ]);
    expect(list.lines[0].amounts).toEqual([
      { quantity: 1010, unit: "g", standard: "gram" },
    ]);
  });

  it("leaves units Mealie has no size for as they are", () => {
    const list = buildShoppingList([
      meal(
        recipe("a", [
          ing({
            quantity: 1.5,
            food: lentils,
            unit: unit("u-x", "", null, null),
          }),
        ]),
        { a: 1 }
      ),
    ]);
    expect(list.lines[0].amounts).toEqual([
      { quantity: 2, unit: "u-x", standard: null },
    ]);
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
        key: "toast|2 slices bread (whole recipe)",
        text: "2 slices bread (whole recipe)",
        times: 1,
        recipeId: "toast",
        recipeName: "Toast",
      },
    ]);
  });

  it("counts a free-text line once per meal, even if the recipe repeats it", () => {
    const stew = {
      id: "stew",
      name: "Stew",
      servings: 2,
      ingredients: [ing({ display: "salt" }), ing({ display: "salt" })],
    };
    const list = buildShoppingList([
      meal(stew, { a: 1 }),
      meal(stew, { a: 1 }),
    ]);
    expect(list.freeText).toMatchObject([{ text: "salt", times: 2 }]);
  });

  it("reports recipes that are gone from Mealie", () => {
    expect(buildShoppingList([meal(null, { a: 1 })]).missing).toEqual(["gone"]);
  });
});

describe("stillNeeded", () => {
  const amt = (
    quantity: number,
    unitLabel: string | null,
    over: Partial<ShoppingAmount> = {}
  ): ShoppingAmount => ({
    quantity,
    unit: unitLabel,
    standard: null,
    ...over,
  });
  const grams = (quantity: number) => amt(quantity, "g", { standard: "gram" });

  it("is what's above the ticked amount, per unit", () => {
    expect(stillNeeded([grams(500)], [{ quantity: 200, unit: "g" }])).toEqual([
      grams(300),
    ]);
  });

  it("is empty when the tick still covers everything", () => {
    expect(stillNeeded([grams(500)], [{ quantity: 500, unit: "g" }])).toEqual(
      []
    );
    expect(stillNeeded([grams(300)], [{ quantity: 500, unit: "g" }])).toEqual(
      []
    );
  });

  it("keeps a unit that wasn't ticked in full, and ignores ticked units that are gone", () => {
    const bunchAmt = amt(1, "bunch");
    expect(
      stillNeeded(
        [grams(500), bunchAmt],
        [
          { quantity: 500, unit: "g" },
          { quantity: 2, unit: "ml" },
        ]
      )
    ).toEqual([bunchAmt]);
  });

  it("matches counts (no unit) on null", () => {
    expect(stillNeeded([amt(3, null)], [{ quantity: 1, unit: null }])).toEqual([
      amt(2, null),
    ]);
  });

  it("rounds a measured remainder up like a measured total", () => {
    // 500 - 123.4 = 376.6, over 100 so up to the next 10.
    expect(stillNeeded([grams(500)], [{ quantity: 123.4, unit: "g" }])).toEqual(
      [grams(380)]
    );
  });

  it("rounds a counted remainder up to a whole one", () => {
    expect(
      stillNeeded([amt(2.5, null)], [{ quantity: 1, unit: null }])
    ).toEqual([amt(2, null)]);
  });

  it("is the full amounts when nothing was ticked per unit", () => {
    expect(stillNeeded([grams(500)], [])).toEqual([grams(500)]);
  });
});

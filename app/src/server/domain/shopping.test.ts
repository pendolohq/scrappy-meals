import { describe, expect, it } from "vitest";

import type { Ingredient } from "../mealie/recipes";

import type { ProductInfo } from "./product";
import {
  buildShoppingList,
  formatAmounts,
  formatProductLine,
  type MealForShopping,
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

type TestRecipe = Omit<NonNullable<MealForShopping["recipe"]>, "product"> & {
  product?: ProductInfo | null;
};

const meal = (
  recipe: TestRecipe | null,
  portions: Record<string, number>,
  baseServings = 1,
  unplanned = false
): MealForShopping => ({
  recipe: recipe && { product: null, ...recipe },
  slug: recipe?.id ?? "gone",
  baseServings,
  unplanned,
  portions,
});

const recipe = (
  id: string,
  ingredients: Ingredient[],
  servings = 1
): TestRecipe => ({
  id,
  name: id,
  servings,
  ingredients,
});

const product = (
  id: string,
  name: string,
  info: Partial<ProductInfo> = {}
): TestRecipe => ({
  id,
  name,
  servings: 1,
  ingredients: [ing({ quantity: 1, food: onion, display: "a sample line" })],
  product: {
    barcode: "5000159461122",
    servingGrams: 60,
    servingUnit: "g",
    packGrams: null,
    ...info,
  },
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

  it("sends grams with the recipes' own one-gram unit, or names the standard", () => {
    const rice = { id: "f-rice", name: "rice" };
    const byKilo = buildShoppingList([
      meal(recipe("a", [ing({ quantity: 1, food: rice, unit: kg })]), { a: 1 }),
    ]);
    expect(byKilo.lines[0].amounts).toEqual([
      { quantity: 1000, unit: "g", unitId: null, standard: "gram" },
    ]);
    const both = buildShoppingList([
      meal(recipe("a", [ing({ quantity: 1, food: rice, unit: kg })]), { a: 1 }),
      meal(recipe("b", [ing({ quantity: 5, food: salt, unit: g })]), { a: 1 }),
    ]);
    expect(both.lines.find((l) => l.foodName === "rice")?.amounts).toEqual([
      { quantity: 1000, unit: "g", unitId: "u-g", standard: "gram" },
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
      { quantity: 2, unit: "u-x", unitId: "u-x", standard: null },
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

  describe("products", () => {
    const bar = product("bar", "Grenade Carb Killa", { packGrams: 60 });
    const box = product("box", "Grenade box", { packGrams: 180 });
    const pot = product("pot", "FAGE Total 0% fat", {
      servingGrams: 100,
      packGrams: 450,
    });

    it("makes one line per product, with no ingredient lines", () => {
      const list = buildShoppingList([meal(bar, { a: 1 })]);
      expect(list.lines).toEqual([]);
      expect(list.freeText).toEqual([]);
      expect(list.unscaled).toEqual([]);
      expect(list.products.map(formatProductLine)).toEqual([
        "Grenade Carb Killa ×1",
      ]);
    });

    it("adds up servings across days and people, then rounds up", () => {
      const list = buildShoppingList([
        meal(bar, { a: 1, b: 0 }),
        meal(bar, { a: 1, b: 1 }),
        meal(bar, { a: 0.5 }),
      ]);
      expect(list.products).toEqual([
        {
          recipeId: "bar",
          name: "Grenade Carb Killa",
          count: 4,
          unitLabel: null,
        },
      ]);
    });

    it("counts half a bar as a bar", () => {
      expect(buildShoppingList([meal(bar, { a: 0.5 })]).products[0].count).toBe(
        1
      );
    });

    it("uses base servings", () => {
      expect(
        buildShoppingList([meal(bar, { a: 1 }, 1.5)]).products[0].count
      ).toBe(2);
    });

    it("skips unplanned entries and meals nobody eats", () => {
      const list = buildShoppingList([
        meal(bar, { a: 1 }, 1, true),
        meal(box, { a: 0 }),
      ]);
      expect(list.products).toEqual([]);
      expect(list.missing).toEqual([]);
    });

    it("counts packs when a pack holds two or more servings", () => {
      // 4.5 servings of 100 g is 450 g: one pot. 5 is 500 g: two.
      expect(
        buildShoppingList([
          meal(pot, { a: 2 }),
          meal(pot, { a: 2.5 }),
        ]).products.map(formatProductLine)
      ).toEqual(["FAGE Total 0% fat ×1 (450 g)"]);
      expect(buildShoppingList([meal(pot, { a: 5 })]).products[0].count).toBe(
        2
      );
      // Four bars of a 3 × 60 g box need two boxes.
      expect(
        buildShoppingList([meal(box, { a: 4 })]).products.map(formatProductLine)
      ).toEqual(["Grenade box ×2 (180 g)"]);
    });

    it("doesn't buy a second pack for floating-point dust", () => {
      // 3 × 70 g of a 210 g box is exactly one box, however it rounds.
      const box70 = product("b70", "Box", { servingGrams: 70, packGrams: 210 });
      expect(
        buildShoppingList([meal(box70, { a: 1 }, 3)]).products[0].count
      ).toBe(1);
      expect(
        buildShoppingList([meal(box70, { a: 1 }, 3.1)]).products[0].count
      ).toBe(2);
    });

    it("counts servings when the pack is unknown or about one serving", () => {
      const unknown = product("u", "Mystery", { packGrams: null });
      const almost = product("a", "Can", { servingGrams: 330, packGrams: 500 });
      expect(
        buildShoppingList([
          meal(unknown, { a: 3 }),
          meal(almost, { a: 2 }),
        ]).products.map(formatProductLine)
      ).toEqual(["Can ×2", "Mystery ×3"]);
    });

    it("keeps products apart from the ingredient lines of other recipes", () => {
      const list = buildShoppingList([
        meal(soup, { a: 4 }),
        meal(bar, { a: 1 }),
      ]);
      expect(list.lines.length).toBeGreaterThan(0);
      expect(list.products).toHaveLength(1);
    });
  });
});

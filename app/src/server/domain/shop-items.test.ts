import { describe, expect, it } from "vitest";

import { buildShopItems } from "./shop-items";
import type {
  FreeTextLine,
  ProductLine,
  ShoppingAmount,
  ShoppingLine,
  WeekIngredients,
} from "./shopping";

const grams = (quantity: number): ShoppingAmount => ({
  quantity,
  unit: "g",
  standard: "gram",
});

const line = (
  key: string,
  foodName: string,
  amounts: ShoppingAmount[],
  over: Partial<ShoppingLine> = {}
): ShoppingLine => ({
  key,
  foodId: key,
  foodName,
  aisle: "Pasta, rice & grains",
  amounts,
  recipes: [
    { id: "soup", name: "Lentil soup" },
    { id: "dal", name: "Dal" },
  ],
  ...over,
});

const freeText = (text: string): FreeTextLine => ({
  key: `soup|${text}`,
  text,
  recipeId: "soup",
  recipeName: "Lentil soup",
  times: 1,
});

const product = (count: number, unitLabel: string | null): ProductLine => ({
  key: "yoghurt|product",
  recipeId: "yoghurt",
  name: "FAGE Total",
  count,
  unitLabel,
});

const plan = (
  lines: ShoppingLine[],
  free: FreeTextLine[] = [],
  products: ProductLine[] = []
): WeekIngredients => ({
  lines,
  products,
  freeText: free,
  unscaled: [],
  missing: [],
});

const none = { ticks: [], hidden: [], extras: [] };

describe("buildShopItems", () => {
  it("lists plan lines with their amount and aisle, without the recipes", () => {
    const items = buildShopItems(
      plan([line("lentils", "lentils", [grams(150)])]),
      none
    );
    expect(items).toMatchObject([
      {
        id: "lentils",
        source: "plan",
        text: "lentils",
        amount: "150 g",
        detail: null,
        aisle: "Pasta, rice & grains",
        checked: false,
        amounts: [{ quantity: 150, unit: "g" }],
      },
    ]);
  });

  it("leaves removed lines out, free text included", () => {
    const items = buildShopItems(
      plan(
        [line("lentils", "lentils", [grams(150)]), line("rice", "rice", [])],
        [freeText("parsley")]
      ),
      {
        ...none,
        hidden: [
          { lineKey: "lentils", amounts: [{ quantity: 150, unit: "g" }] },
          { lineKey: "soup|parsley", amounts: [{ quantity: 1, unit: null }] },
        ],
      }
    );
    expect(items.map((i) => i.id)).toEqual(["rice"]);
  });

  it("brings a removed line back, unticked, when the plan needs more of it", () => {
    const [item] = buildShopItems(
      plan([line("onions", "onions", [grams(700)])]),
      {
        ...none,
        hidden: [
          { lineKey: "onions", amounts: [{ quantity: 200, unit: "g" }] },
        ],
      }
    );
    expect(item).toMatchObject({
      checked: false,
      amount: "500 g more",
      detail: "700 g in all",
    });
  });

  it("shows a line that came back after a removal as ticked once it's bought", () => {
    const [item] = buildShopItems(
      plan([line("onions", "onions", [grams(700)])]),
      {
        ...none,
        ticks: [{ lineKey: "onions", amounts: [{ quantity: 700, unit: "g" }] }],
        hidden: [
          { lineKey: "onions", amounts: [{ quantity: 200, unit: "g" }] },
        ],
      }
    );
    expect(item).toMatchObject({ checked: true, amount: "700 g" });
  });

  it("shows a ticked line as checked when the plan still needs what was bought", () => {
    const [item] = buildShopItems(
      plan([line("lentils", "lentils", [grams(150)])]),
      {
        ...none,
        ticks: [
          { lineKey: "lentils", amounts: [{ quantity: 150, unit: "g" }] },
        ],
      }
    );
    expect(item).toMatchObject({ checked: true, amount: "150 g" });
  });

  it("shows a line the plan has outgrown as unticked, with what's still needed", () => {
    const [item] = buildShopItems(
      plan([line("lentils", "lentils", [grams(500)])]),
      {
        ...none,
        ticks: [
          { lineKey: "lentils", amounts: [{ quantity: 200, unit: "g" }] },
        ],
      }
    );
    expect(item).toMatchObject({
      checked: false,
      amount: "300 g more",
      detail: "500 g in all",
      // A new tick records the whole current amount, not just the difference.
      amounts: [{ quantity: 500, unit: "g" }],
    });
  });

  it("keeps a line that shrank, or lost a unit, ticked", () => {
    const [item] = buildShopItems(
      plan([line("lentils", "lentils", [grams(100)])]),
      {
        ...none,
        ticks: [
          {
            lineKey: "lentils",
            amounts: [
              { quantity: 200, unit: "g" },
              { quantity: 1, unit: "bunch" },
            ],
          },
        ],
      }
    );
    expect(item.checked).toBe(true);
  });

  it("keeps a ticked line without amounts, and a ticked free-text line, ticked", () => {
    const items = buildShopItems(
      plan([line("salt", "salt", [])], [freeText("parsley")]),
      {
        ...none,
        ticks: [
          { lineKey: "salt", amounts: [] },
          { lineKey: "soup|parsley", amounts: [{ quantity: 1, unit: null }] },
        ],
      }
    );
    expect(items.map((i) => [i.id, i.checked])).toEqual([
      ["salt", true],
      ["soup|parsley", true],
    ]);
  });

  it("reopens a ticked free-text line when more meals need it", () => {
    const [item] = buildShopItems(
      plan([], [{ ...freeText("2 lemons, juiced"), times: 2 }]),
      {
        ...none,
        ticks: [
          {
            lineKey: "soup|2 lemons, juiced",
            amounts: [{ quantity: 1, unit: null }],
          },
        ],
      }
    );
    expect(item).toMatchObject({
      text: "2 lemons, juiced (×2)",
      checked: false,
      amount: "×1 more",
      amounts: [{ quantity: 2, unit: null }],
    });
  });

  it("doesn't show a ticked line that left the plan", () => {
    const items = buildShopItems(plan([line("rice", "rice", [])]), {
      ...none,
      ticks: [{ lineKey: "lentils", amounts: [{ quantity: 150, unit: "g" }] }],
    });
    expect(items.map((i) => i.id)).toEqual(["rice"]);
  });

  it("keys free text by recipe and text, in the Other aisle", () => {
    const [item] = buildShopItems(
      plan([], [freeText("a handful of parsley")]),
      none
    );
    expect(item).toMatchObject({
      id: "soup|a handful of parsley",
      source: "plan",
      text: "a handful of parsley",
      amount: null,
      detail: null,
      aisle: "Other",
      checked: false,
      amounts: [{ quantity: 1, unit: null }],
    });
  });

  it("lists a product in its own group, ticks and hides it like any line", () => {
    const pots = plan([], [], [product(1, "450 g")]);
    expect(buildShopItems(pots, none)[0]).toMatchObject({
      id: "yoghurt|product",
      source: "plan",
      text: "FAGE Total",
      amount: "×1 (450 g)",
      aisle: "Products",
      checked: false,
      amounts: [{ quantity: 1, unit: "450 g" }],
    });
    const state = (key: "ticks" | "hidden", quantity: number) => ({
      ...none,
      [key]: [
        { lineKey: "yoghurt|product", amounts: [{ quantity, unit: "450 g" }] },
      ],
    });
    expect(buildShopItems(pots, state("ticks", 1))[0].checked).toBe(true);
    expect(buildShopItems(pots, state("hidden", 1))).toEqual([]);
  });

  it("brings a product back unticked when the plan needs more packs, or another pack size", () => {
    const tick = {
      ...none,
      ticks: [
        {
          lineKey: "yoghurt|product",
          amounts: [{ quantity: 1, unit: "450 g" }],
        },
      ],
    };
    expect(
      buildShopItems(plan([], [], [product(3, "450 g")]), tick)[0]
    ).toMatchObject({
      checked: false,
      amount: "×2 (450 g) more",
      detail: "×3 (450 g) in all",
    });
    expect(
      buildShopItems(plan([], [], [product(1, "500 g")]), tick)[0]
    ).toMatchObject({ checked: false, amount: "×1 (500 g) more" });
  });

  it("puts extras after the plan's lines, in the order given, with the plan's order kept in position", () => {
    const items = buildShopItems(
      plan(
        [line("a", "apples", []), line("b", "bread", [])],
        [freeText("parsley")]
      ),
      {
        ...none,
        extras: [
          { id: "x1", text: "coffee", checked: false },
          { id: "x2", text: "tea", checked: true },
        ],
      }
    );
    expect(items.map((i) => i.id)).toEqual([
      "a",
      "b",
      "soup|parsley",
      "x1",
      "x2",
    ]);
    const positions = items.map((i) => i.position);
    expect(positions).toEqual(positions.toSorted((p, q) => p - q));
    expect(new Set(positions).size).toBe(positions.length);
    expect(items.slice(3)).toMatchObject([
      {
        source: "extra",
        text: "coffee",
        amount: null,
        detail: null,
        aisle: "Other",
        checked: false,
        amounts: [],
      },
      { source: "extra", text: "tea", checked: true },
    ]);
  });
});

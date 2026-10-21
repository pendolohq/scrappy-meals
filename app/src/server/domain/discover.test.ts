import { describe, expect, it } from "vitest";

import {
  discoverHref,
  orderTagChips,
  parseDiscoverParams,
  toggleCategory,
  toggleQuick,
  toggleTag,
} from "./discover";

const known = {
  tags: ["dinner", "breakfast", "high-protein"],
  categories: ["vegan", "vegetarian"],
};

describe("parseDiscoverParams", () => {
  it("reads repeated tags and categories, quick and the page", () => {
    expect(
      parseDiscoverParams(
        {
          tag: ["dinner", "high-protein"],
          category: "vegetarian",
          quick: "1",
          page: "3",
        },
        known
      )
    ).toEqual({
      tags: ["dinner", "high-protein"],
      categories: ["vegetarian"],
      quick: true,
      page: 3,
    });
  });

  it("drops slugs Mealie doesn't have, repeats and bad pages", () => {
    expect(
      parseDiscoverParams(
        { tag: ["dinner", "dinner", "nope"], category: "../x", page: "-2" },
        known
      )
    ).toEqual({ tags: ["dinner"], categories: [], quick: false, page: 1 });
    expect(parseDiscoverParams({ page: "1.5", quick: "yes" }, known)).toEqual({
      tags: [],
      categories: [],
      quick: false,
      page: 1,
    });
  });
});

describe("discoverHref", () => {
  const empty = { tags: [], categories: [], quick: false, page: 1 };

  it("writes the state back as the URL", () => {
    expect(discoverHref(empty)).toBe("/recipes");
    expect(
      discoverHref({
        tags: ["dinner", "high-protein"],
        categories: ["vegan"],
        quick: true,
        page: 2,
      })
    ).toBe(
      "/recipes?tag=dinner&tag=high-protein&category=vegan&quick=1&page=2"
    );
  });

  it("goes back to page 1 when a filter changes", () => {
    const on = { ...empty, tags: ["dinner"], page: 4 };
    expect(discoverHref(toggleTag(on, "dinner"))).toBe("/recipes");
    expect(discoverHref(toggleTag(on, "breakfast"))).toBe(
      "/recipes?tag=dinner&tag=breakfast"
    );
    expect(discoverHref(toggleCategory(on, "vegan"))).toBe(
      "/recipes?tag=dinner&category=vegan"
    );
    expect(discoverHref(toggleQuick(on))).toBe("/recipes?tag=dinner&quick=1");
  });
});

describe("orderTagChips", () => {
  it("puts the agreed tags first, in their order, then the rest by name", () => {
    const chips = orderTagChips(
      [
        { name: "Zesty", slug: "zesty", recipeCount: 1 },
        { name: "Dinner", slug: "dinner", recipeCount: 4 },
        { name: "Autumn", slug: "autumn", recipeCount: 2 },
        { name: "Breakfast", slug: "breakfast", recipeCount: 3 },
      ],
      []
    );
    expect(chips.map((c) => c.slug)).toEqual([
      "breakfast",
      "dinner",
      "autumn",
      "zesty",
    ]);
  });

  it("leaves out tags no recipe has, unless selected", () => {
    const chips = orderTagChips(
      [
        { name: "Dinner", slug: "dinner", recipeCount: 0 },
        { name: "Snack", slug: "snack", recipeCount: 0 },
      ],
      ["snack"]
    );
    expect(chips.map((c) => c.slug)).toEqual(["snack"]);
  });
});

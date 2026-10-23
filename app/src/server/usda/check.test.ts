import { describe, expect, it, vi } from "vitest";

import type { Db } from "../db/client";
import type { CachedRecipe, loadRecipes } from "../recipe-cache";

import { foodUsage, loadInChunks } from "./check";

const recipe = (slug: string, product = false) =>
  ({
    slug,
    product: product ? { barcode: "1" } : null,
    tags: [],
  }) as unknown as CachedRecipe;

describe("loadInChunks", () => {
  const slugs = Array.from({ length: 45 }, (_, i) => `r${i}`);
  const fakeLoad = () =>
    vi.fn<typeof loadRecipes>(
      async (_db, chunk) =>
        new Map(chunk.map((s) => [s, recipe(s, s === "r3")]))
    );

  it("loads 20 at a time and leaves products out", async () => {
    const load = fakeLoad();

    const recipes = await loadInChunks({} as Db, slugs, load);

    expect(load.mock.calls.map((c) => c[1].length)).toEqual([20, 20, 5]);
    expect(recipes).toHaveLength(44);
  });

  it("never refreshes stale recipes from Mealie", async () => {
    const load = fakeLoad();

    await loadInChunks({} as Db, slugs, load);

    for (const call of load.mock.calls) {
      expect(call[2]).toEqual({ refreshStale: false });
    }
  });
});

describe("foodUsage", () => {
  const unit = (name: string, standardUnit: string | null = null) => ({
    id: `u-${name}`,
    name,
    abbreviation: "",
    standardUnit,
    standardQuantity: standardUnit ? 1 : null,
  });
  const line = (
    quantity: number | null,
    u: ReturnType<typeof unit> | null
  ) => ({
    quantity,
    unit: u,
    food: { id: "garlic", name: "garlic" },
    note: "",
    display: `${quantity ?? ""} ${u?.name ?? ""} garlic`,
  });

  it("lists the units with no weight that a food's lines use, once each", () => {
    const recipes = [
      {
        ingredients: [
          line(2, unit("clove")),
          line(3, unit("Cloves")),
          line(1, unit("bulb")),
          line(1, unit("teaspoon", "teaspoon")),
          line(null, unit("pinch")),
          line(1, null),
        ],
      },
    ] as unknown as CachedRecipe[];

    expect(foodUsage(recipes, new Map())[0]!.units).toEqual([
      { key: "clove", name: "clove" },
      { key: "bulb", name: "bulb" },
    ]);
  });
});

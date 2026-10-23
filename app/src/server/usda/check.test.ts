import { describe, expect, it, vi } from "vitest";

import type { Db } from "../db/client";
import type { CachedRecipe, Defer, loadRecipes } from "../recipe-cache";

import { foodUsage, loadInChunks } from "./check";

const recipe = (slug: string, product = false) =>
  ({
    slug,
    product: product ? { barcode: "1" } : null,
    tags: [],
  }) as unknown as CachedRecipe;

describe("loadInChunks", () => {
  const slugs = Array.from({ length: 45 }, (_, i) => `r${i}`);

  function fakeLoad() {
    const log: string[] = [];
    const load = vi.fn<typeof loadRecipes>(async (_db, chunk, opts) => {
      log.push(`load ${chunk[0]}`);
      opts?.defer?.(async () => {
        log.push(`refresh ${chunk[0]}`);
      });
      return new Map(chunk.map((s) => [s, recipe(s, s === "r3")]));
    });
    return { load, log };
  }

  it("loads 20 at a time and leaves products out", async () => {
    const { load } = fakeLoad();

    const recipes = await loadInChunks({} as Db, slugs, undefined, load);

    expect(load.mock.calls.map((c) => c[1].length)).toEqual([20, 20, 5]);
    expect(recipes).toHaveLength(44);
  });

  it("runs every chunk's refresh in one deferred job, chunk by chunk", async () => {
    const { load, log } = fakeLoad();
    const jobs: (() => Promise<void>)[] = [];
    const defer: Defer = (work) => void jobs.push(work);

    await loadInChunks({} as Db, slugs, defer, load);

    expect(jobs).toHaveLength(1);
    expect(log).toEqual(["load r0", "load r20", "load r40"]);
    await jobs[0]!();
    expect(log.slice(3)).toEqual(["refresh r0", "refresh r20", "refresh r40"]);
  });

  it("defers nothing when no chunk was stale", async () => {
    const defer = vi.fn<Defer>();
    const load = vi.fn<typeof loadRecipes>(async (_db, chunk) => {
      return new Map(chunk.map((s) => [s, recipe(s)]));
    });

    await loadInChunks({} as Db, slugs, defer, load);

    expect(defer).not.toHaveBeenCalled();
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

import { describe, expect, it } from "vitest";

import { testDbUrl, useTestDb } from "../../test/db";

import type { Recipe } from "./mealie/recipes";
import { loadRecipes } from "./recipe-cache";

const recipe = (over: Partial<Recipe> = {}): Recipe => ({
  id: "00000000-0000-4000-8000-000000000001",
  slug: "soup",
  name: "Soup",
  imagePath: null,
  servings: 4,
  sourceUrl: null,
  importState: { review: "done", nutrition: null },
  ingredients: [],
  instructions: [],
  notes: [],
  tags: [],
  categories: [],
  totalMinutes: null,
  product: null,
  nutrition: { perServing: {}, missing: [], status: "missing" },
  ...over,
});

describe.skipIf(!testDbUrl)("recipe cache (Postgres)", () => {
  const db = useTestDb();

  it("caches tags, categories and total time", async () => {
    const tagged = recipe({
      tags: [{ name: "Dinner", slug: "dinner" }],
      categories: [{ name: "Vegan", slug: "vegan" }],
      totalMinutes: 25,
    });
    const rows = await loadRecipes(db, ["soup"], {
      fetch: async () => tagged,
    });
    expect(rows.get("soup")).toMatchObject({
      tags: [{ name: "Dinner", slug: "dinner" }],
      categories: [{ name: "Vegan", slug: "vegan" }],
      totalMinutes: 25,
    });
  });

  it("caches where an imported recipe came from and its import state", async () => {
    const imported = recipe({
      sourceUrl: "https://www.instagram.com/reel/abc/",
      importState: { review: "pending", nutrition: "estimated" },
    });
    const rows = await loadRecipes(db, ["soup"], {
      fetch: async () => imported,
    });
    expect(rows.get("soup")).toMatchObject({
      sourceUrl: "https://www.instagram.com/reel/abc/",
      reviewState: "pending",
      nutritionSource: "estimated",
    });
  });

  it("updates the import state when the recipe is refreshed", async () => {
    await loadRecipes(db, ["soup"], {
      fetch: async () =>
        recipe({ importState: { review: "pending", nutrition: "estimated" } }),
    });
    const rows = await loadRecipes(db, ["soup"], {
      force: true,
      fetch: async () =>
        recipe({ importState: { review: "done", nutrition: "reviewed" } }),
    });
    expect(rows.get("soup")).toMatchObject({
      sourceUrl: null,
      reviewState: "done",
      nutritionSource: "reviewed",
    });
  });

  it("caches instructions and notes for the recipe page", async () => {
    const rows = await loadRecipes(db, ["soup"], {
      fetch: async () =>
        recipe({
          instructions: [{ title: null, text: "Simmer." }],
          notes: [{ title: "Freezing", text: "Keeps for 3 months." }],
        }),
    });
    expect(rows.get("soup")).toMatchObject({
      instructions: [{ title: null, text: "Simmer." }],
      notes: [{ title: "Freezing", text: "Keeps for 3 months." }],
    });
  });

  it("caches a product's barcode and serving, and null for a recipe", async () => {
    const info = {
      barcode: "5000159461122",
      servingGrams: 50,
      servingUnit: "g",
      packGrams: null,
    } as const;
    const rows = await loadRecipes(db, ["bar", "soup"], {
      fetch: async (slug) =>
        slug === "bar" ? recipe({ slug: "bar", product: info }) : recipe(),
    });
    expect(rows.get("bar")?.product).toEqual(info);
    expect(rows.get("soup")?.product).toBeNull();
  });

  it("updates the product when the recipe is refreshed", async () => {
    await loadRecipes(db, ["soup"], {
      fetch: async () =>
        recipe({
          product: {
            barcode: "5000159461122",
            servingGrams: 50,
            servingUnit: "g",
            packGrams: null,
          },
        }),
    });
    const rows = await loadRecipes(db, ["soup"], {
      force: true,
      fetch: async () =>
        recipe({
          product: {
            barcode: "5000159461122",
            servingGrams: 25,
            servingUnit: "g",
            packGrams: 100,
          },
        }),
    });
    expect(rows.get("soup")?.product).toMatchObject({
      servingGrams: 25,
      packGrams: 100,
    });
  });

  describe("refreshing stale recipes after the response", () => {
    const later = new Date(Date.now() + 2 * 60 * 60 * 1000);

    const cacheSoup = () =>
      loadRecipes(db, ["soup"], { fetch: async () => recipe() });

    it("queues a stale recipe once, however many times it's loaded meanwhile", async () => {
      await cacheSoup();
      const jobs: (() => Promise<void>)[] = [];
      const defer = (work: () => Promise<void>) => void jobs.push(work);
      let fetches = 0;
      const fetch = async () => {
        fetches += 1;
        return recipe({ name: "Soup, refreshed" });
      };

      for (let i = 0; i < 3; i++) {
        const rows = await loadRecipes(db, ["soup"], {
          fetch,
          defer,
          now: later,
        });
        expect(rows.get("soup")?.name).toBe("Soup");
      }
      expect(jobs).toHaveLength(1);

      await jobs[0]!();
      expect(fetches).toBe(1);
    });

    it("queues it again once the refresh has run", async () => {
      await cacheSoup();
      const jobs: (() => Promise<void>)[] = [];
      const defer = (work: () => Promise<void>) => void jobs.push(work);
      const fetch = async () => recipe();

      await loadRecipes(db, ["soup"], { fetch, defer, now: later });
      await jobs[0]!();
      // The refresh stamped it with `later`; an hour after that it's stale again.
      const evenLater = new Date(later.getTime() + 2 * 60 * 60 * 1000);
      await loadRecipes(db, ["soup"], { fetch, defer, now: evenLater });

      expect(jobs).toHaveLength(2);
      await jobs[1]!();
    });
  });
});

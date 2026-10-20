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
  nutrition: { perServing: {}, missing: [], status: "missing" },
  ...over,
});

describe.skipIf(!testDbUrl)("recipe cache (Postgres)", () => {
  const db = useTestDb();

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
});

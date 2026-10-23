import { describe, expect, it } from "vitest";

import { createMealieClient } from "./client";
import { discoverRecipes, toRecipe } from "./recipes";

const base = {
  id: "00000000-0000-4000-8000-000000000001",
  slug: "soup",
  name: "Soup",
  recipeServings: 4,
};

describe("toRecipe", () => {
  it("keeps instructions with their section titles, and notes", () => {
    const recipe = toRecipe({
      ...base,
      recipeInstructions: [
        { title: "Soup", text: " Rinse the lentils. " },
        { title: "", text: "Simmer for 20 minutes." },
        { title: "To serve", text: "" },
        { title: null, text: "  " },
      ],
      notes: [
        { title: "Freezing", text: "Keeps for 3 months." },
        { title: "", text: "" },
      ],
    });
    expect(recipe.instructions).toEqual([
      { title: "Soup", text: "Rinse the lentils.", ingredientRefs: [] },
      { title: null, text: "Simmer for 20 minutes.", ingredientRefs: [] },
      { title: "To serve", text: "", ingredientRefs: [] },
    ]);
    expect(recipe.notes).toEqual([
      { title: "Freezing", text: "Keeps for 3 months." },
    ]);
  });

  it("has no instructions or notes when Mealie has none", () => {
    const recipe = toRecipe({
      ...base,
      recipeInstructions: null,
      notes: null,
    });
    expect(recipe.instructions).toEqual([]);
    expect(recipe.notes).toEqual([]);
  });

  it("keeps an ingredient's section title", () => {
    const recipe = toRecipe({
      ...base,
      recipeIngredient: [
        { quantity: 0, note: "a squeeze of lemon", title: "To serve" },
        { quantity: 0, note: "salt", title: "" },
      ],
    });
    expect(recipe.ingredients.map((i) => i.title)).toEqual(["To serve", null]);
  });

  it("keeps the links between steps and ingredients", () => {
    const lentils = "00000000-0000-4000-8000-0000000000a1";
    const onion = "00000000-0000-4000-8000-0000000000a2";
    const recipe = toRecipe({
      ...base,
      recipeIngredient: [
        { quantity: 400, note: "lentils", referenceId: lentils },
        { quantity: 1, note: "onion", referenceId: onion },
        { quantity: 0, note: "salt" },
      ],
      recipeInstructions: [
        {
          text: "Fry the onion, add the lentils.",
          ingredientReferences: [
            { referenceId: onion },
            { referenceId: lentils },
            { referenceId: onion },
            { referenceId: null },
          ],
        },
        { text: "Simmer.", ingredientReferences: [] },
        { text: "Serve." },
      ],
    });
    expect(recipe.ingredients.map((i) => i.referenceId)).toEqual([
      lentils,
      onion,
      null,
    ]);
    expect(recipe.instructions.map((s) => s.ingredientRefs)).toEqual([
      [onion, lentils],
      [],
      [],
    ]);
  });

  it("keeps what the shopping list needs: the food's label and density, the unit's size", () => {
    const food = (extras: Record<string, unknown>) => ({
      id: "00000000-0000-4000-8000-0000000000f1",
      name: "flour",
      label: { id: "l1", name: "Baking", groupId: "g1" },
      extras,
    });
    const recipe = toRecipe({
      ...base,
      recipeIngredient: [
        {
          quantity: 1,
          note: "",
          food: food({ scrappyGramsPerMl: "0,53" }),
          unit: {
            id: "00000000-0000-4000-8000-0000000000c1",
            name: "cup",
            standardQuantity: 1,
            standardUnit: "cup",
          },
        },
        { quantity: 1, note: "", food: food({ scrappyGramsPerMl: "lots" }) },
        { quantity: 1, note: "", food: food({}) },
      ],
    });
    expect(recipe.ingredients.map((i) => i.food)).toMatchObject([
      { label: "Baking", gramsPerMl: 0.53 },
      { label: "Baking", gramsPerMl: null },
      { label: "Baking", gramsPerMl: null },
    ]);
    expect(recipe.ingredients[0].unit).toMatchObject({
      standardQuantity: 1,
      standardUnit: "cup",
    });
  });
});

describe("discoverRecipes", () => {
  const filterOf = async (filters: Parameters<typeof discoverRecipes>[0]) => {
    const urls: URL[] = [];
    const client = createMealieClient({
      baseUrl: "http://mealie.test",
      token: "t",
      fetch: async (input) => {
        urls.push(
          new URL(input instanceof Request ? input.url : String(input))
        );
        return Response.json({ items: [], total: 0 });
      },
    });
    await discoverRecipes(filters, { client });
    return urls[0]!.searchParams.get("queryFilter");
  };
  const none = { tags: [], categories: [], quick: false };

  it("leaves products and single foods out when nothing is chosen", async () => {
    expect(await filterOf(none)).toBe('tags.slug NOT IN ["product", "food"]');
    expect(await filterOf({ ...none, quick: true })).toBe(
      '(totalTimeSeconds > 0 AND totalTimeSeconds <= 1800) AND (tags.slug NOT IN ["product", "food"])'
    );
  });

  it("brings them back with a tag or a search", async () => {
    expect(await filterOf({ ...none, tags: ["food"] })).toBeNull();
    expect(await filterOf({ ...none, search: "kiwi" })).toBeNull();
  });
});

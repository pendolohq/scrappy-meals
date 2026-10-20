import { describe, expect, it } from "vitest";

import { toRecipe } from "./recipes";

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
      { title: "Soup", text: "Rinse the lentils." },
      { title: null, text: "Simmer for 20 minutes." },
      { title: "To serve", text: "" },
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
});

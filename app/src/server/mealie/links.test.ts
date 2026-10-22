import { describe, expect, it } from "vitest";

import { mealieNewRecipeUrl, mealieRecipeUrl } from "./links";

describe("Mealie links", () => {
  it("puts a recipe under its group, with or without a trailing slash", () => {
    expect(mealieRecipeUrl("https://recipes.example", "home", "dal")).toBe(
      "https://recipes.example/g/home/r/dal"
    );
    expect(mealieRecipeUrl("https://recipes.example/", "home", "dal")).toBe(
      "https://recipes.example/g/home/r/dal"
    );
  });

  it("opens Mealie's Create recipe page for a new recipe", () => {
    expect(mealieNewRecipeUrl("https://recipes.example/", "home")).toBe(
      "https://recipes.example/g/home/r/create/new"
    );
  });
});

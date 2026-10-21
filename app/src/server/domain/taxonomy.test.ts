import { describe, expect, it } from "vitest";

import {
  categoryFilter,
  classifyCategories,
  classifyRecipe,
  classifyTags,
  formatMinutes,
  isQuick,
  RECIPE_CATEGORIES,
  RECIPE_TAGS,
  slotFromTags,
} from "./taxonomy";

describe("agreed list", () => {
  it("has slugs Mealie would make from the names", () => {
    for (const o of [...RECIPE_TAGS, ...RECIPE_CATEGORIES]) {
      expect(o.slug).toBe(o.name.toLowerCase().replaceAll(" ", "-"));
    }
  });
});

describe("isQuick", () => {
  it("is 30 minutes or less, and never without a time", () => {
    expect(isQuick(30)).toBe(true);
    expect(isQuick(5)).toBe(true);
    expect(isQuick(31)).toBe(false);
    expect(isQuick(null)).toBe(false);
    expect(isQuick(0)).toBe(false);
  });
});

describe("formatMinutes", () => {
  it("shows hours and minutes", () => {
    expect(formatMinutes(25)).toBe("25 min");
    expect(formatMinutes(60)).toBe("1 hr");
    expect(formatMinutes(95)).toBe("1 hr 35 min");
  });
});

describe("slotFromTags", () => {
  it("picks the slot only when one meal tag names it", () => {
    expect(slotFromTags(["breakfast", "high-protein"])).toBe("breakfast");
    expect(slotFromTags(["snack"])).toBe("snack");
    expect(slotFromTags(["lunch", "dinner"])).toBeNull();
    expect(slotFromTags(["dessert"])).toBeNull();
    expect(slotFromTags([])).toBeNull();
  });
});

describe("categoryFilter", () => {
  it("lets vegetarian include vegan", () => {
    expect(categoryFilter(["vegetarian"])).toEqual(["vegetarian", "vegan"]);
    expect(categoryFilter(["vegan"])).toEqual(["vegan"]);
    expect(categoryFilter(["fish"])).toEqual(["fish"]);
  });
});

describe("classifyCategories", () => {
  it.each([
    ["Salmon traybake", ["2 salmon fillets", "1 lemon"], ["fish"]],
    ["Prawn linguine", ["200 g prawns", "linguine"], ["fish"]],
    ["Chicken curry", ["500 g chicken thighs"], ["chicken"]],
    ["Spaghetti bolognese", ["500 g beef mince", "spaghetti"], ["meat"]],
    ["Surf and turf", ["1 steak", "6 prawns"], ["fish", "meat"]],
    ["Bean chilli", ["1 tin kidney beans", "1 onion"], ["vegan"]],
    ["Quorn chilli", ["500 g quorn mince", "1 onion"], ["vegan"]],
    ["Pancakes", ["2 eggs", "250 ml milk", "flour"], ["vegetarian"]],
    ["Halloumi wraps", ["1 block halloumi", "4 tortillas"], ["vegetarian"]],
  ] as const)("%s", (name, ingredients, expected) => {
    expect(classifyCategories(name, [...ingredients])).toEqual(expected);
  });

  it("reads plant milks and nut butters as plant-based", () => {
    expect(
      classifyCategories("Smoothie", [
        "250 ml oat milk",
        "1 tbsp peanut butter",
        "coconut yoghurt",
        "1 flax egg",
      ])
    ).toEqual(["vegan"]);
  });

  it("doesn't mistake minced garlic, eggplant or goat's cheese for meat", () => {
    expect(
      classifyCategories("Aubergine bake", [
        "2 cloves minced garlic",
        "1 eggplant",
        "100 g goat's cheese",
      ])
    ).toEqual(["vegetarian"]);
  });

  it("lets stock and sauces decide only when nothing else does", () => {
    expect(
      classifyCategories("Lentil soup", ["1 l chicken stock", "200 g lentils"])
    ).toEqual(["chicken"]);
    expect(
      classifyCategories("Beef pho", ["beef stock", "300 g beef sirloin"])
    ).toEqual(["meat"]);
    expect(
      classifyCategories("Thai basil chicken", ["chicken mince", "fish sauce"])
    ).toEqual(["chicken"]);
    expect(
      classifyCategories("Veg stir fry", ["2 tbsp fish sauce", "broccoli"])
    ).toEqual(["fish"]);
  });

  it("trusts a recipe that calls itself vegan", () => {
    expect(classifyCategories("Vegan brownies", ["100 g butter"])).toEqual([
      "vegan",
    ]);
  });
});

describe("classifyTags", () => {
  it.each([
    ["Fluffy pancakes", ["breakfast"]],
    ["Overnight oats", ["breakfast"]],
    ["Chocolate brownies", ["dessert"]],
    ["Sticky toffee pudding", ["dessert"]],
    ["Energy balls", ["snack"]],
    ["Greek salad", ["lunch"]],
    ["Tomato soup", ["lunch", "dinner"]],
    ["Thai green curry", ["dinner"]],
    ["Meal prep chicken burrito bowls", ["lunch", "dinner", "meal-prep"]],
    ["High-protein granola", ["breakfast", "high-protein"]],
    ["Banana bread", ["snack"]],
  ] as const)("%s", (name, expected) => {
    expect(classifyTags(name)).toEqual(expected);
  });

  it("doesn't take a Yorkshire pudding for dessert", () => {
    expect(classifyTags("Yorkshire puddings")).toEqual([]);
  });

  it("makes a main course with meat or fish dinner", () => {
    expect(classifyTags("Lemon salmon", { mainProtein: true })).toEqual([
      "dinner",
    ]);
    expect(classifyTags("Lemon salmon")).toEqual([]);
  });

  it("is high protein from 30 g a serving", () => {
    expect(classifyTags("Lentils", { proteinPerServing: 30 })).toEqual([
      "high-protein",
    ]);
    expect(classifyTags("Lentils", { proteinPerServing: 29 })).toEqual([]);
  });
});

describe("classifyRecipe", () => {
  it("returns organizers from the agreed list, in its order", () => {
    expect(
      classifyRecipe({
        name: "Chicken fajitas",
        ingredients: ["500 g chicken breast", "2 peppers"],
        proteinPerServing: 42,
      })
    ).toEqual({
      tags: [
        { name: "Dinner", slug: "dinner" },
        { name: "High protein", slug: "high-protein" },
      ],
      categories: [{ name: "Chicken", slug: "chicken" }],
    });
  });
});

describe("classifyRecipe without ingredients", () => {
  it("leaves the category to the review", () => {
    expect(classifyRecipe({ name: "Mystery", ingredients: [" "] })).toEqual({
      tags: [],
      categories: [],
    });
  });
});

describe("common look-alikes", () => {
  it("reads meat substitutes, butter beans and cream of tartar as plant-based", () => {
    expect(
      classifyCategories("Bean casserole", [
        "6 vegan sausages",
        "1 tin butter beans",
        "½ tsp cream of tartar",
        "plant-based chicken pieces",
      ])
    ).toEqual(["vegan"]);
  });

  it("keeps savoury cakes and sweet potatoes out of dessert", () => {
    expect(classifyTags("Thai fish cakes")).toEqual([]);
    expect(classifyTags("Sweet potato curry")).toEqual(["dinner"]);
    expect(classifyTags("Lemon drizzle cake")).toEqual(["dessert"]);
  });

  it("makes sweet pies and tarts dessert, savoury pies dinner", () => {
    expect(classifyTags("Apple pie")).toEqual(["dessert"]);
    expect(classifyTags("Treacle tart")).toEqual(["dessert"]);
    expect(classifyTags("Chicken and leek pie")).toEqual(["dinner"]);
  });
});

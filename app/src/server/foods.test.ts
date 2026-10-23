import { describe, expect, it, vi } from "vitest";

import type { LineFood } from "./domain/food";
import type { UsdaFood } from "./domain/usda";
import { RetryableError } from "./errors";
import {
  FoodError,
  findFoods,
  loadKnownFood,
  loadUsdaFood,
  saveFood,
  type SaveFoodInput,
} from "./foods";
import { MealieUnavailableError } from "./mealie/client";
import type { FoodRecipeInput } from "./mealie/food-recipes";
import type { RecipeListItem } from "./mealie/recipes";
import type { MatchInput, StoredMatch } from "./usda/foods";

type Deps = Required<NonNullable<Parameters<typeof saveFood>[2]>>;

const USER = "00000000-0000-4000-8000-0000000000u1";

const kiwi: LineFood = {
  id: "00000000-0000-4000-8000-0000000000f1",
  name: "kiwi",
  gramsPerMl: null,
};

const usdaKiwi: UsdaFood = {
  fdcId: 168153,
  description: "Kiwifruit, green, raw",
  dataType: "SR Legacy",
  per100g: { kcal: 61, protein: 1.14, carbs: 14.66, fat: 0.52, fibre: 3 },
  portions: [{ label: "1 fruit", measure: "fruit", grams: 69 }],
};

const stored = (over: Partial<StoredMatch> = {}): StoredMatch => ({
  fdcId: usdaKiwi.fdcId,
  status: "confirmed",
  pieceGrams: 69,
  pieceLabel: "1 fruit",
  unitGrams: { slice: 8 },
  defaultGrams: 69,
  foodName: "kiwi",
  food: usdaKiwi,
  ...over,
});

const listItem = (name: string, slug: string): RecipeListItem => ({
  id: null,
  slug,
  name,
  imagePath: null,
  servings: 1,
  totalMinutes: null,
  isProduct: false,
  isFood: true,
});

function deps(over: Partial<Deps> = {}) {
  const create = vi
    .fn<(input: FoodRecipeInput) => Promise<string>>()
    .mockResolvedValue("kiwi");
  const saveMatch = vi
    .fn<(match: MatchInput, userId: string) => Promise<void>>()
    .mockResolvedValue();
  const takeUsdaCall = vi.fn<(userId: string) => void>();
  const findOrCreateFood = vi
    .fn<Deps["findOrCreateFood"]>()
    .mockResolvedValue({ id: kiwi.id, name: kiwi.name });
  const all: Deps = {
    listRecipes: async () => [],
    searchFoods: async () => [],
    getFood: async (id) => (id === kiwi.id ? kiwi : null),
    findOrCreateFood,
    getRawRecipe: async () => null,
    create,
    listMatches: async () => new Map(),
    usdaFood: async (fdcId) => (fdcId === usdaKiwi.fdcId ? usdaKiwi : null),
    saveMatch,
    usdaEnabled: () => true,
    estimatingEnabled: () => true,
    takeUsdaCall,
    ...over,
  };
  return { all, create, saveMatch, takeUsdaCall, findOrCreateFood };
}

const fromUsda = (over: Partial<SaveFoodInput> = {}): SaveFoodInput => ({
  name: "Kiwi",
  food: { id: kiwi.id },
  serving: { amount: 1, unit: "piece" },
  pieceGrams: null,
  pieceLabel: null,
  nutrition: { from: "usda", fdcId: usdaKiwi.fdcId },
  ...over,
});

describe("findFoods", () => {
  it("lists foods added before and Mealie's foods with their matches, exact names first", async () => {
    const gold = { ...kiwi, id: "gold", name: "kiwi gold" };
    const d = deps({
      listRecipes: async () => [
        listItem("Kiwi gold", "kiwi-gold"),
        listItem("Kiwi", "kiwi"),
      ],
      searchFoods: async () => [gold, kiwi],
      listMatches: async () => new Map([[kiwi.id, stored()]]),
      usdaEnabled: () => false,
    });
    const found = await findFoods("Kiwi", d.all);
    expect(found.recipes.map((r) => r.slug)).toEqual(["kiwi", "kiwi-gold"]);
    expect(found.foods.map((f) => [f.name, f.match?.fdcId ?? null])).toEqual([
      ["kiwi", usdaKiwi.fdcId],
      ["kiwi gold", null],
    ]);
    expect(found).toMatchObject({ usda: false, estimating: true });
  });

  it("asks for a retry while Mealie is down", async () => {
    const d = deps({
      searchFoods: async () => {
        throw new MealieUnavailableError("down");
      },
    });
    await expect(findFoods("Kiwi", d.all)).rejects.toBeInstanceOf(
      RetryableError
    );
  });
});

describe("loadUsdaFood", () => {
  it("counts against the person's USDA calls and refuses an unknown id", async () => {
    const d = deps();
    await expect(loadUsdaFood(usdaKiwi.fdcId, USER, d.all)).resolves.toBe(
      usdaKiwi
    );
    expect(d.takeUsdaCall).toHaveBeenCalledWith(USER);
    await expect(loadUsdaFood(1, USER, d.all)).rejects.toThrow(
      "USDA doesn't have that food."
    );
  });
});

describe("loadKnownFood", () => {
  const raw = (
    extras: Record<string, string>,
    tags = [{ name: "Food", slug: "food" }]
  ) => ({
    id: "00000000-0000-4000-8000-0000000000r1",
    slug: "kiwi",
    name: "Kiwi",
    recipeServings: 1,
    nutrition: { calories: "42" },
    tags: tags.map((t) => ({ ...t, id: "t" })),
    extras,
  });

  it("reads the serving and the nutrition per serving", async () => {
    const d = deps({
      getRawRecipe: (async () =>
        raw({
          scrappyFood: kiwi.id,
          scrappyFoodAmount: "1",
          scrappyFoodUnit: "piece",
          scrappyFoodGrams: "69",
        })) as unknown as Deps["getRawRecipe"],
    });
    await expect(loadKnownFood("kiwi", d.all)).resolves.toEqual({
      slug: "kiwi",
      name: "Kiwi",
      serving: { foodId: kiwi.id, amount: 1, unit: "piece", grams: 69 },
      nutrition: { perServing: { kcal: 42 } },
    });
  });

  it("refuses a recipe that isn't a food, and says when a food's extras are broken", async () => {
    const plain = deps({
      getRawRecipe: (async () =>
        raw({}, [])) as unknown as Deps["getRawRecipe"],
    });
    await expect(loadKnownFood("soup", plain.all)).rejects.toThrow(
      "That isn't a single food"
    );
    const broken = deps({
      getRawRecipe: (async () => raw({})) as unknown as Deps["getRawRecipe"],
    });
    await expect(loadKnownFood("kiwi", broken.all)).rejects.toThrow(
      "incomplete in Mealie"
    );
    await expect(loadKnownFood("gone", deps().all)).rejects.toBeInstanceOf(
      FoodError
    );
  });
});

describe("saveFood from USDA", () => {
  it("counts the serving on the server and saves it as a one-line recipe", async () => {
    const d = deps({
      listMatches: async () => new Map([[kiwi.id, stored()]]),
    });
    await expect(saveFood(fromUsda(), USER, d.all)).resolves.toBe("kiwi");
    expect(d.create).toHaveBeenCalledWith({
      name: "Kiwi",
      food: { id: kiwi.id, name: "kiwi" },
      serving: { amount: 1, unit: "piece", grams: 69 },
      perServing: { kcal: 42, protein: 0.8, carbs: 8, fat: 0.4, fibre: 2.1 },
      nutrition: "source",
    });
    expect(d.takeUsdaCall).toHaveBeenCalledWith(USER);
  });

  it("confirms the food's match with the piece weight, keeping its other weights", async () => {
    const d = deps({
      listMatches: async () =>
        new Map([[kiwi.id, stored({ status: "suggested", pieceGrams: null })]]),
    });
    await saveFood(
      fromUsda({
        pieceGrams: 75,
        pieceLabel: null,
        serving: { amount: 2, unit: "piece" },
      }),
      USER,
      d.all
    );
    expect(d.saveMatch).toHaveBeenCalledWith(
      {
        mealieFoodId: kiwi.id,
        foodName: "kiwi",
        fdcId: usdaKiwi.fdcId,
        status: "confirmed",
        pieceGrams: 75,
        pieceLabel: null,
        unitGrams: { slice: 8 },
        defaultGrams: 69,
      },
      USER
    );
    expect(d.create.mock.calls[0]![0].serving.grams).toBe(150);
  });

  it("drops weights set for another USDA food", async () => {
    const d = deps({
      listMatches: async () =>
        new Map([
          [kiwi.id, stored({ fdcId: 1, food: { ...usdaKiwi, fdcId: 1 } })],
        ]),
    });
    await saveFood(
      fromUsda({ serving: { amount: 150, unit: "g" } }),
      USER,
      d.all
    );
    expect(d.saveMatch.mock.calls[0]![0]).toMatchObject({
      fdcId: usdaKiwi.fdcId,
      pieceGrams: null,
      pieceLabel: null,
      unitGrams: {},
      defaultGrams: null,
    });
  });

  it("finds or creates the Mealie food by name", async () => {
    const d = deps();
    await saveFood(
      fromUsda({ food: { create: "Kiwi" }, pieceGrams: 69 }),
      USER,
      d.all
    );
    expect(d.findOrCreateFood).toHaveBeenCalledWith("Kiwi");
    expect(d.create).toHaveBeenCalled();
  });

  it("refuses a serving it can't weigh, before saving anything", async () => {
    const d = deps();
    await expect(saveFood(fromUsda(), USER, d.all)).rejects.toThrow(
      "Pick or type what one weighs."
    );
    await expect(
      saveFood(fromUsda({ serving: { amount: 200, unit: "ml" } }), USER, d.all)
    ).rejects.toThrow("Give the amount in grams.");
    expect(d.saveMatch).not.toHaveBeenCalled();
    expect(d.create).not.toHaveBeenCalled();
  });

  it("refuses a USDA food FDC doesn't know, and a Mealie food that's gone", async () => {
    const d = deps();
    await expect(
      saveFood(fromUsda({ nutrition: { from: "usda", fdcId: 1 } }), USER, d.all)
    ).rejects.toThrow("USDA doesn't have that food.");
    await expect(
      saveFood(fromUsda({ food: { id: "gone" } }), USER, d.all)
    ).rejects.toThrow("That food is no longer in Mealie");
  });
});

describe("saveFood with its own values", () => {
  const own = (over: Partial<SaveFoodInput> = {}): SaveFoodInput => ({
    name: "Oat flat white",
    food: { create: "oat flat white" },
    serving: { amount: 180, unit: "ml" },
    pieceGrams: null,
    pieceLabel: null,
    nutrition: {
      from: "own",
      perServing: { kcal: 110.4, protein: 1.4999999, carbs: 13, fat: 5.5 },
      estimated: true,
    },
    ...over,
  });

  it("saves Claude's estimate as estimated, with no USDA call or match", async () => {
    const d = deps({
      findOrCreateFood: async () => ({ id: kiwi.id, name: "kiwi" }),
    });
    await saveFood(own(), USER, d.all);
    expect(d.create).toHaveBeenCalledWith(
      expect.objectContaining({
        serving: { amount: 180, unit: "ml", grams: null },
        perServing: { kcal: 110, protein: 1.5, carbs: 13, fat: 5.5 },
        nutrition: "estimated",
      })
    );
    expect(d.takeUsdaCall).not.toHaveBeenCalled();
    expect(d.saveMatch).not.toHaveBeenCalled();
  });

  it("marks typed or edited values reviewed, and weighs pieces by the typed weight", async () => {
    const d = deps();
    await saveFood(
      own({
        food: { id: kiwi.id },
        serving: { amount: 2, unit: "piece" },
        pieceGrams: 70,
        nutrition: { from: "own", perServing: { kcal: 85 }, estimated: false },
      }),
      USER,
      d.all
    );
    expect(d.create.mock.calls[0]![0]).toMatchObject({
      serving: { amount: 2, unit: "piece", grams: 140 },
      nutrition: "reviewed",
    });
  });

  it("needs the calories, and a weight for pieces", async () => {
    const d = deps();
    await expect(
      saveFood(
        own({ nutrition: { from: "own", perServing: {}, estimated: false } }),
        USER,
        d.all
      )
    ).rejects.toThrow("Enter at least the calories.");
    await expect(
      saveFood(own({ serving: { amount: 1, unit: "piece" } }), USER, d.all)
    ).rejects.toThrow("Pick or type what one weighs.");
    expect(d.create).not.toHaveBeenCalled();
  });
});

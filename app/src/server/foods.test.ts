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

const GRAM = {
  id: "unit-g",
  name: "gram",
  abbreviation: "g",
  standardUnit: "gram",
  standardQuantity: 1,
};

const ML = {
  id: "unit-ml",
  name: "millilitre",
  abbreviation: "ml",
  standardUnit: "milliliter",
  standardQuantity: 1,
};

function deps(over: Partial<Deps> = {}) {
  const create = vi
    .fn<(input: FoodRecipeInput) => Promise<string>>()
    .mockResolvedValue("kiwi");
  const saveMatch = vi
    .fn<(match: MatchInput, userId: string) => Promise<void>>()
    .mockResolvedValue();
  const deleteRecipe = vi
    .fn<(slug: string) => Promise<void>>()
    .mockResolvedValue();
  const takeUsdaLookup = vi.fn<(userId: string) => void>();
  const takeUsdaMatch = vi.fn<(userId: string) => void>();
  const usdaFood = vi
    .fn<Deps["usdaFood"]>()
    .mockImplementation(async (fdcId) =>
      fdcId === usdaKiwi.fdcId ? usdaKiwi : null
    );
  const findOrCreateFood = vi
    .fn<Deps["findOrCreateFood"]>()
    .mockResolvedValue({ id: kiwi.id, name: kiwi.name });
  const matchesFor = vi.fn<Deps["matchesFor"]>().mockResolvedValue(new Map());
  const all: Deps = {
    listRecipes: async () => [],
    searchFoods: async () => [],
    getFood: async (id) => (id === kiwi.id ? kiwi : null),
    findOrCreateFood,
    getRawRecipe: async () => null,
    lineUnit: async (unit) => (unit === "g" ? GRAM : ML),
    findRecipe: async () => null,
    create,
    deleteRecipe,
    matchesFor,
    usdaFood,
    saveMatch,
    usdaEnabled: () => true,
    estimatingEnabled: () => true,
    takeUsdaLookup,
    takeUsdaMatch,
    ...over,
  };
  return {
    all,
    create,
    saveMatch,
    deleteRecipe,
    takeUsdaLookup,
    takeUsdaMatch,
    usdaFood,
    findOrCreateFood,
    matchesFor,
  };
}

const matched = (match: StoredMatch) => async (ids: string[]) =>
  new Map(ids.includes(kiwi.id) ? [[kiwi.id, match]] : []);

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
      matchesFor: vi.fn<Deps["matchesFor"]>(matched(stored())),
      usdaEnabled: () => false,
    });
    const found = await findFoods("Kiwi", d.all);
    // Only the matches of the foods listed are read.
    expect(d.all.matchesFor).toHaveBeenCalledWith(["gold", kiwi.id]);
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
  it("counts as a lookup, not a saved match, and refuses an unknown id", async () => {
    const d = deps();
    await expect(loadUsdaFood(usdaKiwi.fdcId, USER, d.all)).resolves.toBe(
      usdaKiwi
    );
    expect(d.takeUsdaLookup).toHaveBeenCalledWith(USER);
    expect(d.takeUsdaMatch).not.toHaveBeenCalled();
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
    const d = deps({ matchesFor: matched(stored()) });
    await expect(saveFood(fromUsda(), USER, d.all)).resolves.toBe("kiwi");
    expect(d.create).toHaveBeenCalledWith({
      name: "Kiwi",
      food: { id: kiwi.id, name: "kiwi" },
      unit: null,
      serving: { amount: 1, unit: "piece", grams: 69 },
      perServing: { kcal: 42, protein: 0.8, carbs: 8, fat: 0.4, fibre: 2.1 },
      nutrition: "source",
    });
  });

  it("uses the food's own match with no USDA call, so it works without a key", async () => {
    const d = deps({
      matchesFor: matched(stored()),
      usdaFood: async () => {
        throw new FoodError("Checking against USDA isn't set up.");
      },
    });
    await expect(saveFood(fromUsda(), USER, d.all)).resolves.toBe("kiwi");
    expect(d.takeUsdaMatch).not.toHaveBeenCalled();
  });

  it("saves a food matched to values typed in from its label", async () => {
    const label = {
      ...usdaKiwi,
      fdcId: -3,
      dataType: "Own values",
      per100g: { kcal: 50, protein: 1, carbs: 10, fat: 0.5, fibre: 3 },
    };
    const d = deps({
      matchesFor: matched(stored({ fdcId: -3, food: label })),
    });
    await saveFood(
      fromUsda({
        serving: { amount: 100, unit: "g" },
        nutrition: { from: "usda", fdcId: -3 },
      }),
      USER,
      d.all
    );
    expect(d.create.mock.calls[0]![0]).toMatchObject({
      unit: { id: GRAM.id, name: GRAM.name },
      perServing: { kcal: 50, carbs: 10 },
    });
    expect(d.usdaFood).not.toHaveBeenCalled();
  });

  it("confirms the food's match with the piece weight, keeping its other weights", async () => {
    const d = deps({
      matchesFor: matched(stored({ status: "suggested", pieceGrams: null })),
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

  it("drops only the piece weight when the food moves to another USDA food", async () => {
    const d = deps({
      matchesFor: matched(
        stored({ fdcId: 1, food: { ...usdaKiwi, fdcId: 1 } })
      ),
    });
    await saveFood(
      fromUsda({ serving: { amount: 150, unit: "g" } }),
      USER,
      d.all
    );
    expect(d.takeUsdaMatch).toHaveBeenCalledWith(USER);
    expect(d.saveMatch.mock.calls[0]![0]).toMatchObject({
      fdcId: usdaKiwi.fdcId,
      pieceGrams: null,
      pieceLabel: null,
      unitGrams: { slice: 8 },
      defaultGrams: 69,
    });
  });

  it("counts grams with Mealie's own unit, and refuses one with no standard", async () => {
    const d = deps({
      lineUnit: async () => ({ ...GRAM, standardQuantity: 1000 }),
    });
    await saveFood(
      fromUsda({ serving: { amount: 0.1, unit: "g" } }),
      USER,
      d.all
    );
    // Mealie's "g" is a kilogram here: the line weighs what the check will weigh.
    expect(d.create.mock.calls[0]![0].serving.grams).toBe(100);

    const none = deps({ lineUnit: async () => null });
    await expect(
      saveFood(
        fromUsda({ serving: { amount: 100, unit: "g" } }),
        USER,
        none.all
      )
    ).rejects.toThrow("Mealie's g unit has no standard size.");
    expect(none.create).not.toHaveBeenCalled();
  });

  it("reuses the same food saved before instead of making another", async () => {
    const findRecipe = vi.fn<Deps["findRecipe"]>().mockResolvedValue("kiwi-1");
    const d = deps({ matchesFor: matched(stored()), findRecipe });
    await expect(saveFood(fromUsda(), USER, d.all)).resolves.toBe("kiwi-1");
    expect(findRecipe).toHaveBeenCalledWith(
      "Kiwi",
      { foodId: kiwi.id, amount: 1, unit: "piece", grams: 69 },
      { kcal: 42, protein: 0.8, carbs: 8, fat: 0.4, fibre: 2.1 }
    );
    expect(d.create).not.toHaveBeenCalled();
    expect(d.saveMatch).toHaveBeenCalled();
  });

  it("creates the recipe before saving the match, and removes it if that fails", async () => {
    const d = deps({
      saveMatch: async () => {
        throw new Error("database down");
      },
    });
    await expect(
      saveFood(fromUsda({ pieceGrams: 69 }), USER, d.all)
    ).rejects.toThrow("database down");
    expect(d.create).toHaveBeenCalled();
    expect(d.deleteRecipe).toHaveBeenCalledWith("kiwi");
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
    const d = deps();
    await saveFood(own(), USER, d.all);
    expect(d.create).toHaveBeenCalledWith(
      expect.objectContaining({
        unit: ML,
        serving: { amount: 180, unit: "ml", grams: null },
        perServing: { kcal: 110, protein: 1.5, carbs: 13, fat: 5.5 },
        nutrition: "estimated",
      })
    );
    expect(d.takeUsdaMatch).not.toHaveBeenCalled();
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
      unit: null,
      serving: { amount: 2, unit: "piece", grams: 140 },
      nutrition: "reviewed",
    });
  });

  it("needs the calories, and a weight for pieces", async () => {
    const d = deps();
    await expect(
      saveFood(
        own({
          nutrition: {
            from: "own",
            perServing: { protein: 5 },
            estimated: false,
          },
        }),
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

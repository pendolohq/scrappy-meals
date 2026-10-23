// Runs against a real Postgres: DATABASE_TEST_URL=postgres://... bun run test:db
import { describe, expect, it, vi } from "vitest";

import { testDbUrl, useTestDb } from "../../../test/db";
import { recipeCache, usdaRecipeReviews } from "../db/schema";
import { UserFacingError } from "../errors";
import { createUser } from "../users";

import { cachedFoods, saveDecision } from "./check";

type Deps = NonNullable<Parameters<typeof saveDecision>[3]>;
type Raw = NonNullable<Awaited<ReturnType<NonNullable<Deps["getRecipe"]>>>>;

const RECIPE_ID = "00000000-0000-4000-8000-0000000000aa";
const USDA = { kcal: 410, protein: 18.5, carbs: 52, fat: 12, fibre: 6.5 };
const CHOSEN = { kcal: 400, protein: 18, carbs: 50, fat: 12.5, fibre: 6 };

const raw = (over: Partial<Raw> = {}): Raw => ({
  id: RECIPE_ID,
  name: "Lentil soup",
  recipeServings: 4,
  nutrition: {
    calories: "320",
    proteinContent: "12",
    carbohydrateContent: "40",
    fatContent: "9",
    fiberContent: "5",
    sodiumContent: "800 mg",
    servingSize: "1 bowl",
  },
  extras: {
    scrappyReview: "done",
    scrappyNutrition: "estimated",
    note: "keep me",
  },
  ...over,
});

function makeDeps(db: Deps["db"], recipe: Raw | null = raw()) {
  const getRecipe = vi
    .fn<NonNullable<Deps["getRecipe"]>>()
    .mockResolvedValue(recipe);
  const patch = vi
    .fn<NonNullable<Deps["patch"]>>()
    .mockResolvedValue(undefined);
  const refresh = vi
    .fn<NonNullable<Deps["refresh"]>>()
    .mockResolvedValue(undefined);
  const usdaPerServing = vi
    .fn<NonNullable<Deps["usdaPerServing"]>>()
    .mockResolvedValue(USDA);
  const deps: Deps = { db, getRecipe, patch, refresh, usdaPerServing };
  return { deps, getRecipe, patch, refresh, usdaPerServing };
}

describe.skipIf(!testDbUrl)("saveDecision (Postgres)", () => {
  const db = useTestDb();
  const newUser = () =>
    createUser(db, {
      name: "Alex",
      email: "alex@example.com",
      password: "hunter2-secret",
    });
  const reviews = () => db.select().from(usdaRecipeReviews);

  it("writes the edited values as strings", async () => {
    const user = await newUser();
    const { deps, patch } = makeDeps(db);

    await saveDecision(
      "lentil-soup",
      { choice: "edited", values: CHOSEN },
      user.id,
      deps
    );

    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch.mock.calls[0]![0]).toBe("lentil-soup");
    expect(patch.mock.calls[0]![1].nutrition).toMatchObject({
      calories: "400",
      proteinContent: "18",
      carbohydrateContent: "50",
      fatContent: "12.5",
      fiberContent: "6",
    });
  });

  it("writes the server's USDA figures for the usda choice, whatever the browser sent", async () => {
    const user = await newUser();
    const { deps, patch } = makeDeps(db);

    await saveDecision(
      "lentil-soup",
      // A caller can add fields the types don't allow; they must be ignored.
      { choice: "usda", values: CHOSEN } as never,
      user.id,
      deps
    );

    expect(patch.mock.calls[0]![1].nutrition).toMatchObject({
      calories: "410",
      proteinContent: "18.5",
      carbohydrateContent: "52",
      fatContent: "12",
      fiberContent: "6.5",
    });
  });

  it("refuses an edit with no values, and writes nothing", async () => {
    const user = await newUser();
    const { deps, patch } = makeDeps(db);

    await expect(
      saveDecision(
        "lentil-soup",
        { choice: "edited", values: {} },
        user.id,
        deps
      )
    ).rejects.toThrow(UserFacingError);
    expect(patch).not.toHaveBeenCalled();
    expect(await reviews()).toEqual([]);
  });

  it("keeps the other nutrition fields", async () => {
    const user = await newUser();
    const { deps, patch } = makeDeps(db);

    await saveDecision(
      "lentil-soup",
      { choice: "edited", values: CHOSEN },
      user.id,
      deps
    );

    expect(patch.mock.calls[0]![1].nutrition).toMatchObject({
      sodiumContent: "800 mg",
      servingSize: "1 bowl",
    });
  });

  it("marks the nutrition reviewed and keeps the other extras", async () => {
    const user = await newUser();
    const { deps, patch } = makeDeps(db);

    await saveDecision("lentil-soup", { choice: "usda" }, user.id, deps);

    expect(patch.mock.calls[0]![1].extras).toEqual({
      scrappyReview: "done",
      scrappyNutrition: "reviewed",
      note: "keep me",
    });
  });

  it("keeps a recipe that is still to review as it is", async () => {
    const user = await newUser();
    const { deps, patch } = makeDeps(
      db,
      raw({
        extras: { scrappyReview: "pending", scrappyNutrition: "estimated" },
      })
    );

    await saveDecision("lentil-soup", { choice: "usda" }, user.id, deps);

    expect(patch.mock.calls[0]![1].extras).toEqual({
      scrappyReview: "pending",
      scrappyNutrition: "reviewed",
    });
  });

  it("refreshes the cache after the patch", async () => {
    const user = await newUser();
    const { deps, patch, refresh } = makeDeps(db);

    await saveDecision("lentil-soup", { choice: "usda" }, user.id, deps);

    expect(refresh).toHaveBeenCalledWith("lentil-soup");
    expect(refresh.mock.invocationCallOrder[0]).toBeGreaterThan(
      patch.mock.invocationCallOrder[0]!
    );
  });

  it("records the decision against the USDA figures of the moment", async () => {
    const user = await newUser();
    const { deps } = makeDeps(db);

    await saveDecision(
      "lentil-soup",
      { choice: "edited", values: CHOSEN },
      user.id,
      deps
    );

    expect(await reviews()).toEqual([
      expect.objectContaining({
        recipeId: RECIPE_ID,
        choice: "edited",
        usdaPerServing: USDA,
        decidedBy: user.id,
      }),
    ]);
  });

  it("replaces the earlier decision on the same recipe", async () => {
    const user = await newUser();
    const { deps, usdaPerServing } = makeDeps(db);
    await saveDecision("lentil-soup", { choice: "usda" }, user.id, deps);

    usdaPerServing.mockResolvedValue({ ...USDA, kcal: 500 });
    await saveDecision(
      "lentil-soup",
      { choice: "edited", values: CHOSEN },
      user.id,
      deps
    );

    expect(await reviews()).toEqual([
      expect.objectContaining({
        choice: "edited",
        usdaPerServing: { ...USDA, kcal: 500 },
      }),
    ]);
  });

  describe("keeping Mealie's values", () => {
    it("leaves the macros as they are but marks the recipe reviewed", async () => {
      const user = await newUser();
      const { deps, patch } = makeDeps(db);
      const before = raw().nutrition;

      await saveDecision("lentil-soup", { choice: "mealie" }, user.id, deps);

      const fields = patch.mock.calls[0]![1];
      expect(fields.nutrition ?? before).toEqual(before);
      expect(fields.extras).toMatchObject({
        scrappyNutrition: "reviewed",
        note: "keep me",
      });
      expect(await reviews()).toEqual([
        expect.objectContaining({ choice: "mealie", usdaPerServing: USDA }),
      ]);
    });
  });

  it("says so when the recipe no longer exists, and saves nothing", async () => {
    const user = await newUser();
    const { deps, patch, refresh } = makeDeps(db, null);

    await expect(
      saveDecision("gone", { choice: "usda" }, user.id, deps)
    ).rejects.toThrow(UserFacingError);

    expect(patch).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(await reviews()).toEqual([]);
  });

  it("doesn't record a decision when Mealie rejects the write", async () => {
    const user = await newUser();
    const { deps, patch } = makeDeps(db);
    patch.mockRejectedValue(new Error("Mealie said no"));

    await expect(
      saveDecision("lentil-soup", { choice: "usda" }, user.id, deps)
    ).rejects.toThrow("Mealie said no");

    expect(await reviews()).toEqual([]);
  });
});

describe.skipIf(!testDbUrl)("cachedFoods (Postgres)", () => {
  const db = useTestDb();

  it("counts the foods in cached recipes, most-used first, without Mealie", async () => {
    const line = (id: string, name: string, display: string) => ({
      quantity: 1,
      food: { id, name },
      unit: null,
      note: "",
      display,
    });
    const row = (slug: string, ingredients: object[], product = null) => ({
      slug,
      mealieId: crypto.randomUUID(),
      name: slug,
      nutrition: { perServing: {}, missing: [], status: "missing" as const },
      ingredients: ingredients as never,
      product,
    });
    await db
      .insert(recipeCache)
      .values([
        row("a", [
          line("f-oil", "olive oil", "1 tbsp olive oil"),
          line("f-egg", "egg", "2 eggs"),
        ]),
        row("b", [line("f-oil", "olive oil", "2 tbsp olive oil")]),
        row("p", [line("f-bar", "bar", "1 bar")], { barcode: "1" } as never),
      ]);

    const foods = await cachedFoods(db);

    expect(foods.map((f) => [f.id, f.uses])).toEqual([
      ["f-oil", 2],
      ["f-egg", 1],
    ]);
    expect(foods[0]!.lines).toEqual(["1 tbsp olive oil", "2 tbsp olive oil"]);
  });
});

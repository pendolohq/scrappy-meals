import "server-only";

import { getDb } from "./db/client";
import {
  type FoodServing,
  type FoodUnit,
  type LineFood,
  servingNutrition,
} from "./domain/food";
import { FOOD_TAG } from "./domain/taxonomy";
import type { UsdaFood } from "./domain/usda";
import { roundMacro } from "./domain/usda-check";
import { UserFacingError } from "./errors";
import {
  createFoodRecipe,
  type FoodRecipeInput,
  getFood,
  searchFoods,
} from "./mealie/food-recipes";
import { type FoodState, readFoodState } from "./mealie/food-state";
import { findOrCreateFood, getRawRecipe } from "./mealie/import";
import { MACRO_KEYS, type MacroKey, type Macros } from "./mealie/nutrition";
import {
  listFoodRecipes,
  type RecipeListItem,
  toRecipe,
} from "./mealie/recipes";
import { estimatingEnabled } from "./nutrition-estimate";
import { whenMealieAnswers } from "./recipe-review";
import { usdaClient, usdaEnabled } from "./usda/client";
import {
  ensureFoods,
  listMatches,
  type MatchInput,
  saveMatch,
  type StoredMatch,
} from "./usda/foods";
import { usdaLimits } from "./usda/limits";

export class FoodError extends UserFacingError {
  name = "FoodError";
}

/** A Mealie food the sheet offers, with its USDA match if it has one. */
export type FoodCandidate = LineFood & { match: StoredMatch | null };

export type FoodSearch = {
  /** Foods added before under this name: one tap adds one again. */
  recipes: RecipeListItem[];
  foods: FoodCandidate[];
  /** USDA can be searched (the server has an FDC key). */
  usda: boolean;
  /** Claude can estimate a food USDA doesn't have. */
  estimating: boolean;
};

export type KnownFood = {
  slug: string;
  name: string;
  serving: FoodState;
  nutrition: { perServing: Partial<Macros> };
};

export type SaveFoodInput = {
  /** The recipe's name, as typed: "Kiwi", "Cappuccino". */
  name: string;
  /** A Mealie food picked from the search, or the name of one to find or create. */
  food: { id: string } | { create: string };
  serving: { amount: number; unit: FoodUnit };
  /** What one piece weighs; saved on the food's USDA match. */
  pieceGrams: number | null;
  /** The USDA portion the piece weight was picked from ("1 fruit"). */
  pieceLabel: string | null;
  nutrition:
    | { from: "usda"; fdcId: number }
    | { from: "own"; perServing: Partial<Macros>; estimated: boolean };
};

type Deps = {
  listRecipes: (search: string) => Promise<RecipeListItem[]>;
  searchFoods: (query: string) => Promise<LineFood[]>;
  getFood: (id: string) => Promise<LineFood | null>;
  findOrCreateFood: (name: string) => Promise<{ id: string; name: string }>;
  getRawRecipe: typeof getRawRecipe;
  create: (input: FoodRecipeInput) => Promise<string>;
  listMatches: () => Promise<Map<string, StoredMatch>>;
  /** The USDA food, from our cache or FDC; null when FDC doesn't know it. */
  usdaFood: (fdcId: number) => Promise<UsdaFood | null>;
  saveMatch: (match: MatchInput, userId: string) => Promise<void>;
  usdaEnabled: () => boolean;
  estimatingEnabled: () => boolean;
  /** Throws once someone has made too many USDA calls this hour. */
  takeUsdaCall: (userId: string) => void;
};

const defaults = (): Deps => ({
  listRecipes: async (search) => (await listFoodRecipes({ search })).items,
  searchFoods: (query) => searchFoods(query),
  getFood: (id) => getFood(id),
  findOrCreateFood: (name) => findOrCreateFood(name),
  getRawRecipe: (slug) => getRawRecipe(slug),
  create: (input) => createFoodRecipe(input),
  listMatches: () => listMatches(getDb()),
  usdaFood: async (fdcId) => {
    const client = usdaClient();
    if (!client) {
      throw new FoodError("Checking against USDA isn't set up.");
    }
    return (await ensureFoods(getDb(), client, [fdcId])).get(fdcId) ?? null;
  },
  saveMatch: (match, userId) => saveMatch(getDb(), match, userId),
  usdaEnabled: () => usdaEnabled(),
  estimatingEnabled: () => estimatingEnabled(),
  takeUsdaCall: (userId) => usdaLimits.confirm(userId),
});

const withDefaults = (deps: Partial<Deps>): Deps => ({
  ...defaults(),
  ...deps,
});

const same = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * What the name could be: foods added before under it, and Mealie's foods
 * with their USDA matches. One spelled exactly like the name comes first.
 */
export async function findFoods(
  name: string,
  deps: Partial<Deps> = {}
): Promise<FoodSearch> {
  const d = withDefaults(deps);
  const [recipes, foods, matches] = await whenMealieAnswers(() =>
    Promise.all([d.listRecipes(name), d.searchFoods(name), d.listMatches()])
  );
  const exactFirst = <T extends { name: string }>(list: T[]) =>
    list.toSorted(
      (a, b) => Number(same(b.name, name)) - Number(same(a.name, name))
    );
  return {
    recipes: exactFirst(recipes),
    foods: exactFirst(foods).map((f) => ({
      ...f,
      match: matches.get(f.id) ?? null,
    })),
    usda: d.usdaEnabled(),
    estimating: d.estimatingEnabled(),
  };
}

/** A USDA food with its portions, for the sheet to weigh a serving with. */
export async function loadUsdaFood(
  fdcId: number,
  userId: string,
  deps: Partial<Deps> = {}
): Promise<UsdaFood> {
  const d = withDefaults(deps);
  d.takeUsdaCall(userId);
  const food = await d.usdaFood(fdcId);
  if (!food) {
    throw new FoodError("USDA doesn't have that food.");
  }
  return food;
}

/** A food added before, by slug (picked from search or the sheet's list). */
export async function loadKnownFood(
  slug: string,
  deps: Partial<Deps> = {}
): Promise<KnownFood> {
  const d = withDefaults(deps);
  const raw = await whenMealieAnswers(() => d.getRawRecipe(slug));
  if (!raw) {
    throw new FoodError("That food is no longer in Mealie");
  }
  const recipe = toRecipe(raw);
  const serving = readFoodState(raw.extras);
  if (!serving) {
    const tagged = recipe.tags.some((t) => t.slug === FOOD_TAG.slug);
    throw new FoodError(
      tagged
        ? "That food is incomplete in Mealie. Fix it there, or remove it."
        : "That isn't a single food"
    );
  }
  return {
    slug: recipe.slug,
    name: recipe.name,
    serving,
    nutrition: { perServing: recipe.nutrition.perServing },
  };
}

const PROBLEMS = {
  "no piece weight": "Pick or type what one weighs.",
  "no volume weight":
    "USDA has no weight for a volume of this. Give the amount in grams.",
} as const;

/**
 * Saves a single food as a one-line Mealie recipe and returns its slug. From
 * USDA, the serving is counted on the server from the food's match, which is
 * confirmed (with the piece weight) for every recipe that uses the food;
 * nothing the browser computed is written. Otherwise the values are the
 * person's, or Claude's estimate.
 */
export async function saveFood(
  input: SaveFoodInput,
  userId: string,
  deps: Partial<Deps> = {}
): Promise<string> {
  const d = withDefaults(deps);
  const { serving, nutrition } = input;
  if (
    serving.unit === "piece" &&
    nutrition.from === "own" &&
    !input.pieceGrams
  ) {
    throw new FoodError(PROBLEMS["no piece weight"]);
  }
  if (nutrition.from === "usda") {
    d.takeUsdaCall(userId);
  }
  return whenMealieAnswers(async () => {
    const ref =
      "id" in input.food
        ? input.food
        : await d.findOrCreateFood(input.food.create);
    const food = await d.getFood(ref.id);
    if (!food) {
      throw new FoodError("That food is no longer in Mealie");
    }

    let recipe: Omit<FoodRecipeInput, "name" | "food">;
    if (nutrition.from === "usda") {
      const usda = await d.usdaFood(nutrition.fdcId);
      if (!usda) {
        throw new FoodError("USDA doesn't have that food.");
      }
      const current = (await d.listMatches()).get(food.id);
      // A weight or default set for another USDA food isn't this one's.
      const kept = current?.fdcId === usda.fdcId ? current : null;
      const typed = input.pieceGrams !== null;
      const match: MatchInput = {
        mealieFoodId: food.id,
        foodName: food.name,
        fdcId: usda.fdcId,
        status: "confirmed",
        pieceGrams: typed ? input.pieceGrams : (kept?.pieceGrams ?? null),
        pieceLabel: typed ? input.pieceLabel : (kept?.pieceLabel ?? null),
        unitGrams: kept?.unitGrams ?? {},
        defaultGrams: kept?.defaultGrams ?? null,
      };
      const counted = servingNutrition(serving, food, { ...match, food: usda });
      if ("problem" in counted) {
        throw new FoodError(PROBLEMS[counted.problem]);
      }
      await d.saveMatch(match, userId);
      recipe = {
        serving: { ...serving, grams: roundGrams(counted.grams) },
        perServing: counted.perServing,
        nutrition: "source",
      };
    } else {
      if (MACRO_KEYS.every((m) => nutrition.perServing[m] === undefined)) {
        throw new FoodError("Enter at least the calories.");
      }
      recipe = {
        serving: {
          ...serving,
          grams: gramsOf(serving, food, input.pieceGrams),
        },
        perServing: Object.fromEntries(
          Object.entries(nutrition.perServing).map(([k, v]) => [
            k,
            roundMacro(k as MacroKey, v),
          ])
        ),
        nutrition: nutrition.estimated ? "estimated" : "reviewed",
      };
    }
    return d.create({
      name: input.name,
      food: { id: food.id, name: food.name },
      ...recipe,
    });
  });
}

const roundGrams = (grams: number) => Math.round(grams * 100) / 100;

/** What a serving weighs without a USDA match: typed for a piece, through the density for ml. */
function gramsOf(
  serving: { amount: number; unit: FoodUnit },
  food: LineFood,
  pieceGrams: number | null
): FoodServing["grams"] {
  switch (serving.unit) {
    case "g":
      return serving.amount;
    case "ml":
      return food.gramsPerMl
        ? roundGrams(serving.amount * food.gramsPerMl)
        : null;
    case "piece":
      return pieceGrams === null
        ? null
        : roundGrams(serving.amount * pieceGrams);
  }
}

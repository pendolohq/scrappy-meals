import "server-only";

import { getDb } from "./db/client";
import {
  type FoodServing,
  type FoodUnit,
  type LineFood,
  servingNutrition,
} from "./domain/food";
import { isFoodRecipe } from "./domain/taxonomy";
import type { UsdaFood } from "./domain/usda";
import { roundMacro } from "./domain/usda-check";
import { UserFacingError } from "./errors";
import {
  createFoodRecipe,
  deleteRecipe,
  findFoodRecipe,
  findLineUnit,
  type FoodRecipeInput,
  getFood,
  searchFoods,
} from "./mealie/food-recipes";
import { type FoodState, readFoodState } from "./mealie/food-state";
import { findOrCreateFood, getRawRecipe } from "./mealie/import";
import type { MacroKey, Macros } from "./mealie/nutrition";
import {
  type Ingredient,
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
  /** Mealie's gram or millilitre unit; null when it has no standard size. */
  lineUnit: (unit: "g" | "ml") => Promise<Ingredient["unit"]>;
  /** The slug of a food recipe with this name, food, serving and nutrition already. */
  findRecipe: (
    name: string,
    state: FoodState,
    perServing: Partial<Macros>,
    nutrition: FoodRecipeInput["nutrition"]
  ) => Promise<string | null>;
  create: (input: FoodRecipeInput) => Promise<string>;
  deleteRecipe: (slug: string) => Promise<void>;
  /** The saved matches of these Mealie foods, by food id. */
  matchesFor: (foodIds: string[]) => Promise<Map<string, StoredMatch>>;
  /** The USDA food, from our cache or FDC; null when FDC doesn't know it. */
  usdaFood: (fdcId: number) => Promise<UsdaFood | null>;
  saveMatch: (match: MatchInput, userId: string) => Promise<void>;
  usdaEnabled: () => boolean;
  estimatingEnabled: () => boolean;
  /** Throws once someone has looked up too many USDA foods this hour. */
  takeUsdaLookup: (userId: string) => void;
  /** Throws once someone has saved too many matches this hour. */
  takeUsdaMatch: (userId: string) => void;
};

const defaults = (): Deps => ({
  listRecipes: async (search) => (await listFoodRecipes({ search })).items,
  searchFoods: (query) => searchFoods(query),
  getFood: (id) => getFood(id),
  findOrCreateFood: (name) => findOrCreateFood(name),
  getRawRecipe: (slug) => getRawRecipe(slug),
  lineUnit: (unit) => findLineUnit(unit),
  findRecipe: (name, state, perServing, nutrition) =>
    findFoodRecipe(name, state, perServing, nutrition),
  create: (input) => createFoodRecipe(input),
  deleteRecipe: (slug) => deleteRecipe(slug),
  matchesFor: (foodIds) => listMatches(getDb(), foodIds),
  usdaFood: async (fdcId) => {
    // Values typed in from a label have negative ids and are only in our
    // cache, reached through the food's own match.
    if (fdcId <= 0) {
      return null;
    }
    const client = usdaClient();
    if (!client) {
      throw new FoodError("Checking against USDA isn't set up.");
    }
    return (await ensureFoods(getDb(), client, [fdcId])).get(fdcId) ?? null;
  },
  saveMatch: (match, userId) => saveMatch(getDb(), match, userId),
  usdaEnabled: () => usdaEnabled(),
  estimatingEnabled: () => estimatingEnabled(),
  takeUsdaLookup: (userId) => usdaLimits.search(userId),
  takeUsdaMatch: (userId) => usdaLimits.confirm(userId),
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
  const [recipes, foods] = await whenMealieAnswers(() =>
    Promise.all([d.listRecipes(name), d.searchFoods(name)])
  );
  const matches = await d.matchesFor(foods.map((f) => f.id));
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
  // Only a look: saving a match counts against its own limit.
  d.takeUsdaLookup(userId);
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
    throw new FoodError(
      isFoodRecipe(recipe.tags)
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
 * USDA, the serving is counted on the server from the food's match, exactly
 * as the check will count the recipe's line, and the match is confirmed (with
 * the piece weight) for every recipe that uses the food; nothing the browser
 * computed is written. Otherwise the values are the person's, or Claude's
 * estimate. The same food saved again (a retry, or added a second time)
 * reuses its recipe.
 */
export async function saveFood(
  input: SaveFoodInput,
  userId: string,
  deps: Partial<Deps> = {}
): Promise<string> {
  const d = withDefaults(deps);
  const { serving, nutrition } = input;
  if (nutrition.from === "own") {
    if (nutrition.perServing.kcal === undefined) {
      throw new FoodError("Enter at least the calories.");
    }
    if (serving.unit === "piece" && !input.pieceGrams) {
      throw new FoodError(PROBLEMS["no piece weight"]);
    }
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
    const unit =
      serving.unit === "piece" ? null : await d.lineUnit(serving.unit);
    if (serving.unit !== "piece" && !unit) {
      throw new FoodError(
        `Mealie's ${serving.unit} unit has no standard size. Set one in Mealie.`
      );
    }

    let match: MatchInput | null = null;
    let recipe: Omit<FoodRecipeInput, "name" | "food" | "unit">;
    if (nutrition.from === "usda") {
      const current = (await d.matchesFor([food.id])).get(food.id);
      const same = current?.fdcId === nutrition.fdcId;
      // The food's own match needs no USDA call (and may be values typed in
      // from a label, which USDA doesn't have); another food is a new match.
      if (!same) {
        d.takeUsdaMatch(userId);
      }
      const usda = same ? current!.food : await d.usdaFood(nutrition.fdcId);
      if (!usda) {
        throw new FoodError("USDA doesn't have that food.");
      }
      const typed = input.pieceGrams !== null;
      // A piece weight is the USDA food's portion, so it holds only for that
      // food; the unit weights and default amount are the Mealie food's own,
      // as on the foods page.
      match = {
        mealieFoodId: food.id,
        foodName: food.name,
        fdcId: usda.fdcId,
        status: "confirmed",
        pieceGrams: typed
          ? input.pieceGrams
          : same
            ? current!.pieceGrams
            : null,
        pieceLabel: typed
          ? input.pieceLabel
          : same
            ? current!.pieceLabel
            : null,
        unitGrams: current?.unitGrams ?? {},
        defaultGrams: current?.defaultGrams ?? null,
      };
      const counted = servingNutrition(
        serving,
        food,
        { ...match, food: usda },
        unit
      );
      if ("problem" in counted) {
        throw new FoodError(PROBLEMS[counted.problem]);
      }
      recipe = {
        serving: { ...serving, grams: roundGrams(counted.grams) },
        perServing: counted.perServing,
        nutrition: "source",
      };
    } else {
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

    const existing = await d.findRecipe(
      input.name,
      { ...recipe.serving, foodId: food.id },
      recipe.perServing,
      recipe.nutrition
    );
    const slug =
      existing ??
      (await d.create({
        name: input.name,
        food: { id: food.id, name: food.name },
        unit,
        ...recipe,
      }));
    if (match) {
      try {
        await d.saveMatch(match, userId);
      } catch (err) {
        // Without the match the new recipe's figures stand on nothing; a
        // retry makes it again.
        if (!existing) {
          await d.deleteRecipe(slug).catch(() => undefined);
        }
        throw err;
      }
    }
    return slug;
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

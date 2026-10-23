import { inArray } from "drizzle-orm";

import "server-only";

import { type Db, getDb } from "../db/client";
import { recipeCache, usdaRecipeReviews } from "../db/schema";
import { PRODUCT_TAG } from "../domain/taxonomy";
import type { UsdaHit } from "../domain/usda";
import {
  checkRecipe,
  type CheckStatus,
  type RecipeCheck,
} from "../domain/usda-check";
import { UserFacingError } from "../errors";
import { getRawRecipe, patchRecipe } from "../mealie/import";
import { readImportState, withImportState } from "../mealie/import-state";
import { MACRO_KEYS, type Macros, NUTRITION_FIELDS } from "../mealie/nutrition";
import { listAllRecipes } from "../mealie/recipes";
import { type CachedRecipe, type Defer, loadRecipes } from "../recipe-cache";
import { whenMealieAnswers } from "../recipe-review";

import { usdaClient } from "./client";
import { ensureFoods, listMatches, type StoredMatch, saveMatch } from "./foods";
import { usdaLimits } from "./limits";
import {
  asRetryable,
  claudeDeps,
  suggestMatches,
  SUGGEST_BATCH,
  takeSuggestRun,
} from "./suggest";

const CHUNK = 20;

const isProduct = (r: CachedRecipe) =>
  r.product !== null || (r.tags ?? []).some((t) => t.slug === PRODUCT_TAG.slug);

const requireClient = () => {
  const client = usdaClient();
  if (!client) {
    throw new UserFacingError("Checking against USDA isn't set up.");
  }
  return client;
};

type Load = typeof loadRecipes;

/**
 * The recipes by slug, 20 at a time. Stale ones are refreshed after the
 * response, all in one deferred job that goes chunk by chunk, so a page load
 * never sends Mealie a burst of requests.
 */
export async function loadInChunks(
  db: Db,
  slugs: string[],
  defer?: Defer,
  load: Load = loadRecipes
): Promise<CachedRecipe[]> {
  const jobs: (() => Promise<void>)[] = [];
  const collect: Defer | undefined = defer && ((work) => void jobs.push(work));
  const recipes: CachedRecipe[] = [];
  for (let i = 0; i < slugs.length; i += CHUNK) {
    const loaded = await load(db, slugs.slice(i, i + CHUNK), {
      defer: collect,
    });
    for (const recipe of loaded.values()) {
      if (recipe && !isProduct(recipe)) {
        recipes.push(recipe);
      }
    }
  }
  if (defer && jobs.length > 0) {
    defer(async () => {
      for (const job of jobs) {
        await job();
      }
    });
  }
  return recipes;
}

/** Every recipe but the products, from our cache, 20 at a time. */
async function loadAllRecipes(db: Db, defer?: Defer): Promise<CachedRecipe[]> {
  const list = await whenMealieAnswers(() => listAllRecipes());
  return loadInChunks(
    db,
    list.map((r) => r.slug),
    defer
  );
}

/** What the cache holds, for actions that mustn't wait on Mealie. */
async function cachedRecipes(db: Db): Promise<CachedRecipe[]> {
  return (await db.select().from(recipeCache)).filter((r) => !isProduct(r));
}

const reviewsFor = async (db: Db, recipeIds: string[]) =>
  new Map(
    (recipeIds.length === 0
      ? []
      : await db
          .select()
          .from(usdaRecipeReviews)
          .where(inArray(usdaRecipeReviews.recipeId, recipeIds))
    ).map((r) => [r.recipeId, r])
  );

const toCheck = (
  recipe: CachedRecipe,
  matches: Awaited<ReturnType<typeof listMatches>>,
  review: { usdaPerServing: Partial<Macros> } | undefined
) =>
  checkRecipe(
    {
      servings: recipe.servings,
      perServing: recipe.nutrition.perServing,
      ingredients: recipe.ingredients,
    },
    matches,
    review
  );

export type CheckedRecipe = {
  slug: string;
  name: string;
  imagePath: string | null;
  check: RecipeCheck;
};

export const CHECK_GROUPS: CheckStatus[] = [
  "mismatch",
  "cantCheck",
  "reviewed",
  "match",
];

export type FoodUsage = {
  id: string;
  name: string;
  /** Ingredient lines that use it, across all recipes. */
  uses: number;
  /** A few of those lines, to tell what the food is. */
  lines: string[];
  match: StoredMatch | null;
};

function foodUsage(
  recipes: CachedRecipe[],
  matches: Map<string, StoredMatch>
): FoodUsage[] {
  const foods = new Map<string, FoodUsage>();
  for (const recipe of recipes) {
    for (const line of recipe.ingredients) {
      if (!line.food) {
        continue;
      }
      const food = foods.get(line.food.id) ?? {
        id: line.food.id,
        name: line.food.name,
        uses: 0,
        lines: [],
        match: matches.get(line.food.id) ?? null,
      };
      food.uses += 1;
      if (
        food.lines.length < 3 &&
        line.display &&
        !food.lines.includes(line.display)
      ) {
        food.lines.push(line.display);
      }
      foods.set(food.id, food);
    }
  }
  return [...foods.values()].sort(
    (a, b) => b.uses - a.uses || a.name.localeCompare(b.name)
  );
}

/** The foods in the cached recipes, most-used first; never calls Mealie. */
export async function cachedFoods(db: Db): Promise<FoodUsage[]> {
  const [recipes, matches] = await Promise.all([
    cachedRecipes(db),
    listMatches(db),
  ]);
  return foodUsage(recipes, matches);
}

/** Foods the recipes use, most-used first. */
export async function loadFoods(db: Db, defer?: Defer): Promise<FoodUsage[]> {
  const [recipes, matches] = await Promise.all([
    loadAllRecipes(db, defer),
    listMatches(db),
  ]);
  return foodUsage(recipes, matches);
}

/** Every recipe with its check, and the foods they use, from one load of the recipes. */
export async function loadOverview(
  db: Db,
  defer?: Defer
): Promise<{ recipes: CheckedRecipe[]; foods: FoodUsage[] }> {
  const [recipes, matches] = await Promise.all([
    loadAllRecipes(db, defer),
    listMatches(db),
  ]);
  const reviews = await reviewsFor(
    db,
    recipes.map((r) => r.mealieId)
  );
  return {
    recipes: recipes.map((r) => ({
      slug: r.slug,
      name: r.name,
      imagePath: r.imagePath,
      check: toCheck(r, matches, reviews.get(r.mealieId)),
    })),
    foods: foodUsage(recipes, matches),
  };
}

export type RecipeBreakdown = {
  slug: string;
  name: string;
  servings: number | null;
  check: RecipeCheck;
  /** The USDA food each ingredient line was matched to, in line order. */
  usdaFoods: (string | null)[];
  review: { choice: "mealie" | "usda" | "edited"; decidedAt: Date } | null;
};

/** One recipe's check, line by line; null when it doesn't exist or is a product. */
export async function loadBreakdown(
  db: Db,
  slug: string,
  opts: { defer?: Defer; force?: boolean } = {}
): Promise<RecipeBreakdown | null> {
  const recipe = (
    await loadRecipes(db, [slug], { defer: opts.defer, force: opts.force })
  ).get(slug);
  if (!recipe || isProduct(recipe)) {
    return null;
  }
  const matches = await listMatches(db);
  const review = (await reviewsFor(db, [recipe.mealieId])).get(recipe.mealieId);
  return {
    slug: recipe.slug,
    name: recipe.name,
    servings: recipe.servings,
    check: toCheck(recipe, matches, review),
    usdaFoods: recipe.ingredients.map((line) => {
      const match = line.food && matches.get(line.food.id);
      return match?.status === "confirmed" ? match.food.description : null;
    }),
    review: review
      ? { choice: review.choice, decidedAt: review.decidedAt }
      : null,
  };
}

export async function searchUsda(
  query: string,
  userId: string
): Promise<UsdaHit[]> {
  const client = requireClient();
  usdaLimits.search(userId);
  return client.search(query, 10);
}

/**
 * Confirms the USDA food for a Mealie food that a recipe uses, fetching and
 * caching it first. The name saved is the one from the recipes, not the input.
 */
export async function confirmMatch(
  db: Db,
  input: {
    foodId: string;
    fdcId: number;
    pieceGrams: number | null;
    pieceLabel: string | null;
  },
  userId: string
): Promise<void> {
  const client = requireClient();
  usdaLimits.confirm(userId);
  const food = (await cachedFoods(db)).find((f) => f.id === input.foodId);
  if (!food) {
    throw new UserFacingError("No recipe uses that food any more.");
  }
  const cached = await ensureFoods(db, client, [input.fdcId]);
  if (!cached.has(input.fdcId)) {
    throw new UserFacingError("USDA doesn't have that food.");
  }
  await saveMatch(
    db,
    {
      mealieFoodId: food.id,
      foodName: food.name,
      fdcId: input.fdcId,
      status: "confirmed",
      pieceGrams: input.pieceGrams,
      pieceLabel: input.pieceLabel,
    },
    userId
  );
}

/**
 * Suggests a USDA food for the next foods with no match, most-used first, and
 * saves them as `suggested` for a person to confirm.
 */
export async function suggestNext(
  db: Db,
  userId: string
): Promise<{ tried: number; suggested: number }> {
  const client = requireClient();
  const deps = claudeDeps((query, pageSize) => client.search(query, pageSize));
  if (!deps) {
    throw new UserFacingError("Suggesting matches isn't set up.");
  }
  const foods = (await cachedFoods(db))
    .filter((f) => !f.match)
    .slice(0, SUGGEST_BATCH);
  if (foods.length === 0) {
    return { tried: 0, suggested: 0 };
  }
  takeSuggestRun(userId);
  let picks: Awaited<ReturnType<typeof suggestMatches>>;
  try {
    picks = await suggestMatches(
      foods.map((f) => ({ id: f.id, name: f.name, lines: f.lines })),
      deps
    );
  } catch (err) {
    throw asRetryable(err);
  }
  const cached = await ensureFoods(
    db,
    client,
    picks.map((p) => p.hit.fdcId)
  );
  // Someone may have confirmed a food while Claude was working.
  const now = await listMatches(db);
  let suggested = 0;
  for (const { foodId, hit } of picks) {
    const food = foods.find((f) => f.id === foodId);
    if (!food || now.has(foodId) || !cached.has(hit.fdcId)) {
      continue;
    }
    await saveMatch(
      db,
      {
        mealieFoodId: foodId,
        foodName: food.name,
        fdcId: hit.fdcId,
        status: "suggested",
        pieceGrams: null,
        pieceLabel: null,
      },
      userId
    );
    suggested += 1;
  }
  return { tried: foods.length, suggested };
}

type RawRecipe = {
  id?: string | null;
  name?: string | null;
  recipeServings?: number | null;
  nutrition?: Record<string, string | null> | null;
  extras?: Record<string, unknown> | null;
};

type DecisionDeps = {
  db: Db;
  getRecipe: (slug: string) => Promise<RawRecipe | null>;
  patch: (
    slug: string,
    fields: Parameters<typeof patchRecipe>[1]
  ) => Promise<void>;
  refresh: (slug: string) => Promise<void>;
  /** The USDA figures per serving as of now; null when the recipe can't be checked. */
  usdaPerServing: (slug: string) => Promise<Partial<Macros> | null>;
};

const decisionDefaults = (db: Db): DecisionDeps => ({
  db,
  getRecipe: (slug) => getRawRecipe(slug),
  patch: (slug, fields) => patchRecipe(slug, fields),
  refresh: async (slug) => {
    await loadRecipes(db, [slug], { force: true });
  },
  usdaPerServing: async (slug) =>
    (await loadBreakdown(db, slug, { force: true }))?.check.usdaPerServing ??
    null,
});

export type Decision =
  | { choice: "mealie" | "usda" }
  | { choice: "edited"; values: Partial<Macros> };

/**
 * Keeps Mealie's values, or writes USDA's (or edited ones) into the recipe's
 * nutrition in one PATCH, and marks the nutrition reviewed. The decision is
 * recorded against the USDA figures as they are now, and only once Mealie has
 * accepted the write.
 */
export async function saveDecision(
  slug: string,
  decision: Decision,
  userId: string,
  deps: Partial<DecisionDeps> = {}
): Promise<void> {
  const d = { ...decisionDefaults(deps.db ?? getDb()), ...deps };
  await whenMealieAnswers(async () => {
    const recipe = await d.getRecipe(slug);
    if (!recipe?.id) {
      throw new UserFacingError("That recipe no longer exists in Mealie.");
    }
    const usda = await d.usdaPerServing(slug);
    if (!usda) {
      throw new UserFacingError(
        "This recipe can't be checked yet. Match its foods first."
      );
    }
    // Only the nutrition becomes reviewed; the recipe's own review state stays.
    const extras = withImportState(recipe.extras, {
      review: readImportState(recipe.extras).review,
      nutrition: "reviewed",
    });
    // "Use USDA's" writes the figures the server just computed, never ones
    // sent by the browser.
    const values =
      decision.choice === "edited"
        ? decision.values
        : decision.choice === "usda"
          ? usda
          : null;
    if (values && MACRO_KEYS.every((m) => values[m] === undefined)) {
      throw new UserFacingError("Enter at least one value.");
    }
    if (!values) {
      await d.patch(slug, { extras });
    } else {
      const nutrition: Record<string, string | null> = { ...recipe.nutrition };
      for (const macro of MACRO_KEYS) {
        const value = values[macro];
        if (value !== undefined) {
          nutrition[NUTRITION_FIELDS[macro]] = String(value);
        }
      }
      await d.patch(slug, { nutrition, extras });
    }
    await d.refresh(slug);
    const row = {
      recipeId: recipe.id,
      usdaPerServing: usda,
      choice: decision.choice,
      decidedBy: userId,
      decidedAt: new Date(),
    };
    await d.db
      .insert(usdaRecipeReviews)
      .values(row)
      .onConflictDoUpdate({ target: usdaRecipeReviews.recipeId, set: row });
  });
}

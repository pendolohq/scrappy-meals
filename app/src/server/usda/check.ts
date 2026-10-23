import { inArray, sql } from "drizzle-orm";

import "server-only";

import { type Db, getDb } from "../db/client";
import { recipeCache, usdaRecipeReviews } from "../db/schema";
import { PRODUCT_TAG } from "../domain/taxonomy";
import { measure } from "../domain/units";
import type { UsdaHit } from "../domain/usda";
import {
  checkRecipe,
  type CheckStatus,
  type RecipeCheck,
  unitKey,
} from "../domain/usda-check";
import { UserFacingError } from "../errors";
import { getRawRecipe, patchRecipe } from "../mealie/import";
import { readImportState, withImportState } from "../mealie/import-state";
import { MACRO_KEYS, type Macros, NUTRITION_FIELDS } from "../mealie/nutrition";
import { listAllRecipes } from "../mealie/recipes";
import { type CachedRecipe, type Defer, loadRecipes } from "../recipe-cache";
import { whenMealieAnswers } from "../recipe-review";

import { usdaClient } from "./client";
import {
  ensureFoods,
  listMatches,
  listSuggestMisses,
  saveMatch,
  saveSuggestion,
  saveSuggestMisses,
  type StoredMatch,
} from "./foods";
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
 * The recipes by slug from our cache, 20 at a time. Only recipes not cached
 * yet are fetched from Mealie. Stale ones are used as they are: these pages
 * read every recipe and reload after each click, and a cached copy is enough
 * to count ingredients. Other pages keep the cache fresh.
 */
export async function loadInChunks(
  db: Db,
  slugs: string[],
  load: Load = loadRecipes
): Promise<CachedRecipe[]> {
  const recipes: CachedRecipe[] = [];
  for (let i = 0; i < slugs.length; i += CHUNK) {
    const loaded = await load(db, slugs.slice(i, i + CHUNK), {
      refreshStale: false,
    });
    for (const recipe of loaded.values()) {
      if (recipe && !isProduct(recipe)) {
        recipes.push(recipe);
      }
    }
  }
  return recipes;
}

/** Every recipe Mealie lists, but the products, from our cache. */
async function loadAllRecipes(db: Db): Promise<CachedRecipe[]> {
  const list = await whenMealieAnswers(() => listAllRecipes());
  return loadInChunks(
    db,
    list.map((r) => r.slug)
  );
}

/** Mealie's name for a food some cached recipe uses; null when none does. */
export async function cachedFoodName(
  db: Db,
  foodId: string
): Promise<string | null> {
  const uses = JSON.stringify([{ food: { id: foodId } }]);
  const rows = await db
    .select()
    .from(recipeCache)
    .where(sql`${recipeCache.ingredients} @> ${uses}::jsonb`);
  for (const recipe of rows.filter((r) => !isProduct(r))) {
    const line = recipe.ingredients.find((l) => l.food?.id === foodId);
    if (line?.food) {
      return line.food.name;
    }
  }
  return null;
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
  /** Units its lines use that are neither a weight nor a volume, by `unitKey`. */
  units: { key: string; name: string }[];
  match: StoredMatch | null;
};

export function foodUsage(
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
        units: [],
        match: matches.get(line.food.id) ?? null,
      };
      food.uses += 1;
      const { quantity, unit } = line;
      if (quantity !== null && unit && !measure(quantity, unit)) {
        const key = unitKey(unit);
        if (key && !food.units.some((u) => u.key === key)) {
          food.units.push({ key, name: unit.name.trim() });
        }
      }
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

/** Foods the recipes use, most-used first. */
export async function loadFoods(db: Db): Promise<FoodUsage[]> {
  const [recipes, matches] = await Promise.all([
    loadAllRecipes(db),
    listMatches(db),
  ]);
  return foodUsage(recipes, matches);
}

/** Every recipe with its check, and the foods they use, from one load of the recipes. */
export async function loadOverview(
  db: Db
): Promise<{ recipes: CheckedRecipe[]; foods: FoodUsage[] }> {
  const [recipes, matches, reviews] = await Promise.all([
    loadAllRecipes(db),
    listMatches(db),
    // Every review: there are at most as many as recipes, and fetching them
    // alongside saves waiting on the recipes first.
    db
      .select()
      .from(usdaRecipeReviews)
      .then((rows) => new Map(rows.map((r) => [r.recipeId, r]))),
  ]);
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
    unitGrams: Record<string, number>;
  },
  userId: string
): Promise<void> {
  const client = requireClient();
  usdaLimits.confirm(userId);
  const foodName = await cachedFoodName(db, input.foodId);
  if (foodName === null) {
    throw new UserFacingError("No recipe uses that food any more.");
  }
  const cached = await ensureFoods(db, client, [input.fdcId]);
  if (!cached.has(input.fdcId)) {
    throw new UserFacingError("USDA doesn't have that food.");
  }
  await saveMatch(
    db,
    {
      mealieFoodId: input.foodId,
      foodName,
      fdcId: input.fdcId,
      status: "confirmed",
      pieceGrams: input.pieceGrams,
      pieceLabel: input.pieceLabel,
      unitGrams: input.unitGrams,
    },
    userId
  );
}

/**
 * Suggests a USDA food for the next foods with no match, most-used first, and
 * saves them as `suggested` for a person to confirm. Foods it finds nothing
 * for are remembered and not tried again, so each run gets further down the list.
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
  const [all, misses] = await Promise.all([
    loadFoods(db),
    listSuggestMisses(db),
  ]);
  const foods = all
    .filter((f) => !f.match && !misses.has(f.id))
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
  const found = new Set<string>();
  let suggested = 0;
  for (const { foodId, hit } of picks) {
    const food = foods.find((f) => f.id === foodId);
    if (!food || !cached.has(hit.fdcId)) {
      continue;
    }
    found.add(foodId);
    // Someone may have matched the food while Claude was working; theirs stays.
    if (
      await saveSuggestion(
        db,
        { mealieFoodId: foodId, foodName: food.name, fdcId: hit.fdcId },
        userId
      )
    ) {
      suggested += 1;
    }
  }
  await saveSuggestMisses(
    db,
    foods.filter((f) => !found.has(f.id)).map((f) => f.id)
  );
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

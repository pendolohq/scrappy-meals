import { eq, inArray } from "drizzle-orm";

import "server-only";

import type { Db } from "./db/client";
import { mealSlots, recipeCache } from "./db/schema";
import { getRecipe, type Recipe } from "./mealie/recipes";

export type CachedRecipe = typeof recipeCache.$inferSelect;
export type RecipeFetcher = (slug: string) => Promise<Recipe | null>;

const MAX_AGE_MS = 60 * 60 * 1000;

/** Runs work after the response is sent: `after` from next/server in a page. */
export type Defer = (work: () => Promise<void>) => void;

/**
 * Stale recipes already queued for a refresh after a response, with when they
 * were queued. A page loaded meanwhile leaves them to that refresh instead of
 * queuing the same Mealie requests again: otherwise a page that reloads after
 * every click (the USDA foods list) piles up enough requests to exhaust
 * Mealie's database connections. An entry older than this lets a refresh that
 * never ran be queued again.
 */
const queued = new Map<string, number>();
const QUEUED_FOR_MS = 5 * 60 * 1000;

/**
 * Recipes by slug, served from our cache and refreshed from Mealie when older
 * than an hour. If Mealie is unreachable, a stale entry is better than
 * nothing, so it is kept. A recipe deleted in Mealie maps to null.
 *
 * - `defer`: stale entries are returned as they are and refreshed after the
 *   response, so a slow Mealie never holds up a page. Only recipes not cached
 *   at all are fetched before returning.
 * - `force`: every slug is fetched now, and a failed fetch throws.
 */
export async function loadRecipes(
  db: Db,
  slugs: string[],
  opts: {
    fetch?: RecipeFetcher;
    now?: Date;
    force?: boolean;
    defer?: Defer;
  } = {}
): Promise<Map<string, CachedRecipe | null>> {
  const unique = [...new Set(slugs)];
  const result = new Map<string, CachedRecipe | null>();
  if (unique.length === 0) {
    return result;
  }

  const fetchRecipe = opts.fetch ?? ((slug: string) => getRecipe(slug));
  const now = opts.now ?? new Date();

  const rows = await db
    .select()
    .from(recipeCache)
    .where(inArray(recipeCache.slug, unique));
  const cached = new Map(rows.map((r) => [r.slug, r]));

  const refresh = async (slug: string) => {
    try {
      let recipe = await fetchRecipe(slug);
      const known = cached.get(slug);
      if (!recipe && known) {
        // Renaming a recipe in Mealie gives it a new slug but keeps its id:
        // find it by id and move the planned meals over.
        recipe = await fetchRecipe(known.mealieId);
        if (recipe) {
          await db
            .update(mealSlots)
            .set({ mealieRecipeSlug: recipe.slug })
            .where(eq(mealSlots.mealieRecipeSlug, slug));
          await db.delete(recipeCache).where(eq(recipeCache.slug, slug));
        }
      }
      if (!recipe) {
        await db.delete(recipeCache).where(eq(recipeCache.slug, slug));
        cached.delete(slug);
        result.set(slug, null);
        return;
      }
      const values = {
        slug: recipe.slug,
        mealieId: recipe.id,
        name: recipe.name,
        imagePath: recipe.imagePath,
        servings: recipe.servings,
        nutrition: recipe.nutrition,
        ingredients: recipe.ingredients,
        instructions: recipe.instructions,
        notes: recipe.notes,
        sourceUrl: recipe.sourceUrl,
        tags: recipe.tags,
        categories: recipe.categories,
        totalMinutes: recipe.totalMinutes,
        product: recipe.product,
        reviewState: recipe.importState.review,
        nutritionSource: recipe.importState.nutrition,
        fetchedAt: now,
      };
      const [row] = await db
        .insert(recipeCache)
        .values(values)
        .onConflictDoUpdate({ target: recipeCache.slug, set: values })
        .returning();
      cached.set(slug, row);
    } catch (err) {
      if (opts.force) {
        throw err;
      }
      console.warn(
        `recipe ${slug}: refresh from Mealie failed, using cached copy if any`,
        err
      );
    }
  };

  const missing = unique.filter((slug) => opts.force || !cached.has(slug));
  const stale = unique.filter((slug) => {
    const row = cached.get(slug);
    return (
      row &&
      !missing.includes(slug) &&
      now.getTime() - row.fetchedAt.getTime() > MAX_AGE_MS
    );
  });
  const { defer } = opts;
  if (defer && stale.length > 0) {
    const toQueue = stale.filter(
      (slug) => now.getTime() - (queued.get(slug) ?? 0) > QUEUED_FOR_MS
    );
    for (const slug of toQueue) {
      queued.set(slug, now.getTime());
    }
    if (toQueue.length > 0) {
      defer(async () => {
        try {
          await Promise.all(toQueue.map(refresh));
        } finally {
          for (const slug of toQueue) {
            queued.delete(slug);
          }
        }
      });
    }
    await Promise.all(missing.map(refresh));
  } else {
    await Promise.all([...missing, ...stale].map(refresh));
  }

  for (const slug of unique) {
    if (!result.has(slug)) {
      result.set(slug, cached.get(slug) ?? null);
    }
  }
  return result;
}

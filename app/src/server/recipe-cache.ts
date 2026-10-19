import { inArray } from "drizzle-orm";

import "server-only";

import type { Db } from "./db/client";
import { recipeCache } from "./db/schema";
import { getRecipe, type Recipe } from "./mealie/recipes";

export type CachedRecipe = typeof recipeCache.$inferSelect;
export type RecipeFetcher = (slug: string) => Promise<Recipe | null>;

const MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Recipes by slug, served from our cache and refreshed from Mealie when older
 * than an hour. If Mealie is unreachable, a stale entry is better than
 * nothing, so it is kept. A recipe deleted in Mealie maps to null.
 */
export async function loadRecipes(
  db: Db,
  slugs: string[],
  opts: {
    fetch?: RecipeFetcher;
    maxAgeMs?: number;
    now?: Date;
    force?: boolean;
  } = {}
): Promise<Map<string, CachedRecipe | null>> {
  const unique = [...new Set(slugs)];
  const result = new Map<string, CachedRecipe | null>();
  if (unique.length === 0) {
    return result;
  }

  const fetchRecipe = opts.fetch ?? ((slug: string) => getRecipe(slug));
  const now = opts.now ?? new Date();
  const maxAge = opts.maxAgeMs ?? MAX_AGE_MS;

  const rows = await db
    .select()
    .from(recipeCache)
    .where(inArray(recipeCache.slug, unique));
  const cached = new Map(rows.map((r) => [r.slug, r]));
  const stale = unique.filter((slug) => {
    const row = cached.get(slug);
    return (
      opts.force || !row || now.getTime() - row.fetchedAt.getTime() > maxAge
    );
  });

  await Promise.all(
    stale.map(async (slug) => {
      try {
        const recipe = await fetchRecipe(slug);
        if (!recipe) {
          await db.delete(recipeCache).where(inArray(recipeCache.slug, [slug]));
          cached.delete(slug);
          result.set(slug, null);
          return;
        }
        const values = {
          slug,
          mealieId: recipe.id,
          name: recipe.name,
          imagePath: recipe.imagePath,
          servings: recipe.servings,
          nutrition: recipe.nutrition,
          ingredients: recipe.ingredients,
          mealieUpdatedAt: recipe.updatedAt ? new Date(recipe.updatedAt) : null,
          fetchedAt: now,
        };
        const [row] = await db
          .insert(recipeCache)
          .values(values)
          .onConflictDoUpdate({ target: recipeCache.slug, set: values })
          .returning();
        cached.set(slug, row);
      } catch (err) {
        console.warn(
          `recipe ${slug}: refresh from Mealie failed, using cached copy if any`,
          err
        );
      }
    })
  );

  for (const slug of unique) {
    if (!result.has(slug)) {
      result.set(slug, cached.get(slug) ?? null);
    }
  }
  return result;
}

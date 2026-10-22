import "server-only";

import { mealie, unwrap } from "./client";

let cachedGroupSlug: Promise<string> | undefined;

// The group never changes while the app runs; a failed lookup is retried.
export const groupSlug = () => {
  cachedGroupSlug ??= mealie()
    .GET("/api/groups/self")
    .then((r) => unwrap(r).slug)
    .catch((err: unknown) => {
      cachedGroupSlug = undefined;
      throw err;
    });
  return cachedGroupSlug;
};

/** Mealie v3's page for a recipe; its URLs carry the group's slug. */
export const mealieRecipeUrl = (base: string, group: string, slug: string) =>
  `${base.replace(/\/$/, "")}/g/${group}/r/${slug}`;

/** Mealie v3's "Create recipe" page, which starts a recipe from its name. */
export const mealieNewRecipeUrl = (base: string, group: string) =>
  mealieRecipeUrl(base, group, "create/new");

/**
 * A page in Mealie, at `MEALIE_PUBLIC_URL`. Null when that isn't set, or
 * Mealie can't be asked for the group right now.
 */
async function linkInMealie(
  url: (base: string, group: string) => string
): Promise<string | null> {
  const base = process.env.MEALIE_PUBLIC_URL;
  if (!base) {
    return null;
  }
  try {
    return url(base, await groupSlug());
  } catch (err) {
    console.warn("no link to Mealie: group lookup failed", err);
    return null;
  }
}

/** The recipe's page in Mealie, or null (see `linkInMealie`). */
export const recipeLinkInMealie = (slug: string) =>
  linkInMealie((base, group) => mealieRecipeUrl(base, group, slug));

/** Mealie's page for writing a new recipe, or null (see `linkInMealie`). */
export const newRecipeLinkInMealie = () => linkInMealie(mealieNewRecipeUrl);

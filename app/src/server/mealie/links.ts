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

/**
 * The recipe's page in Mealie, at `MEALIE_PUBLIC_URL`. Null when that isn't
 * set, or Mealie can't be asked for the group right now.
 */
export async function recipeLinkInMealie(slug: string): Promise<string | null> {
  const base = process.env.MEALIE_PUBLIC_URL;
  if (!base) {
    return null;
  }
  try {
    return mealieRecipeUrl(base, await groupSlug(), slug);
  } catch (err) {
    console.warn("no link to Mealie: group lookup failed", err);
    return null;
  }
}

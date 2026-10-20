import "server-only";

import { RetryableError, UserFacingError } from "./errors";
import { isMealieUnavailable } from "./mealie/client";
import {
  findRecipeBySourceUrl,
  getRawRecipe,
  importRecipeFromUrl,
  patchRecipe,
} from "./mealie/import";
import { withImportState } from "./mealie/import-state";
import { createRateLimiter } from "./rate-limit";

export type ImportResult =
  | { status: "imported"; slug: string }
  | { status: "exists"; slug: string; name: string };

type FetchedRecipe = {
  nutrition?: Record<string, string | null> | null;
  extras?: Record<string, unknown> | null;
};

type Deps = {
  find: (url: string) => Promise<{ slug: string; name: string } | null>;
  importFromUrl: (url: string) => Promise<string | null>;
  getRecipe: (slug: string) => Promise<FetchedRecipe | null>;
  patch: (
    slug: string,
    fields: { extras: Record<string, string> }
  ) => Promise<void>;
  limiter: { hit: (key: string) => boolean };
};

// Each import makes Mealie fetch a third-party page (and later may spend AI
// credits), so a signed-in user can't hammer it.
const limiter = createRateLimiter({ limit: 20, windowMs: 60 * 60 * 1000 });

const defaults: Deps = {
  find: (url) => findRecipeBySourceUrl(url),
  importFromUrl: (url) => importRecipeFromUrl(url),
  getRecipe: getRawRecipe,
  patch: (slug, fields) => patchRecipe(slug, fields),
  limiter,
};

/**
 * Imports the recipe on a web page through Mealie and marks it as awaiting
 * review. A page that was already imported is reported, not imported twice.
 */
export async function importRecipe(
  url: string,
  userId: string,
  deps: Partial<Deps> = {}
): Promise<ImportResult> {
  const d = { ...defaults, ...deps };
  if (!d.limiter.hit(userId)) {
    throw new UserFacingError("Too many imports. Try again in a while.");
  }
  try {
    const existing = await d.find(url);
    if (existing) {
      return { status: "exists", ...existing };
    }
    const slug = await d.importFromUrl(url);
    if (!slug) {
      throw new UserFacingError("Couldn't find a recipe on that page.");
    }
    const recipe = await d.getRecipe(slug);
    const hasNutrition = Object.values(recipe?.nutrition ?? {}).some(
      (v) => typeof v === "string" && v !== ""
    );
    // Null: the recipe was deleted since the import, nothing left to mark.
    if (recipe) {
      await d.patch(slug, {
        extras: withImportState(recipe.extras, {
          review: "pending",
          nutrition: hasNutrition ? "source" : null,
        }),
      });
    }
    return { status: "imported", slug };
  } catch (err) {
    if (isMealieUnavailable(err)) {
      console.error("recipe import failed", err);
      throw new RetryableError(
        "Mealie didn't answer. If the page was slow, the recipe may still appear: try again in a minute."
      );
    }
    throw err;
  }
}

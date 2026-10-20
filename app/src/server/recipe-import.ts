import "server-only";

import { RetryableError, UserFacingError } from "./errors";
import { isMealieUnavailable } from "./mealie/client";
import {
  findRecipeBySourceUrl,
  getRawRecipe,
  importRecipeFromUrl,
  patchRecipe,
} from "./mealie/import";
import { IMPORT_EXTRAS, withImportState } from "./mealie/import-state";
import { MACRO_KEYS, NUTRITION_FIELDS } from "./mealie/nutrition";
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

// One import per page at a time: a second submission while the first is
// still running (a double click, or someone else in the household) waits for
// it instead of importing the page again.
const inFlight = new Map<string, Promise<ImportResult>>();

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
  const running = inFlight.get(url);
  if (running) {
    return running;
  }
  const work = runImport(url, d).finally(() => inFlight.delete(url));
  inFlight.set(url, work);
  return work;
}

async function runImport(url: string, d: Deps): Promise<ImportResult> {
  try {
    const existing = await d.find(url);
    if (existing) {
      // An earlier import can create the recipe and still fail before
      // marking it (a timeout, a failed PATCH); this retry finishes the job.
      const recipe = await d.getRecipe(existing.slug);
      if (recipe && !(IMPORT_EXTRAS.review in (recipe.extras ?? {}))) {
        await markPending(existing.slug, recipe, d);
      }
      return { status: "exists", ...existing };
    }
    const slug = await d.importFromUrl(url);
    if (!slug) {
      throw new UserFacingError("Couldn't find a recipe on that page.");
    }
    const recipe = await d.getRecipe(slug);
    // Null: the recipe was deleted since the import, nothing left to mark.
    if (recipe) {
      await markPending(slug, recipe, d);
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

async function markPending(slug: string, recipe: FetchedRecipe, d: Deps) {
  // Only the macros count: a page giving just sodium has no usable nutrition.
  const hasNutrition = MACRO_KEYS.some((m) => {
    const v = recipe.nutrition?.[NUTRITION_FIELDS[m]];
    return typeof v === "string" && v.trim() !== "";
  });
  await d.patch(slug, {
    extras: withImportState(recipe.extras, {
      review: "pending",
      nutrition: hasNutrition ? "source" : null,
    }),
  });
}

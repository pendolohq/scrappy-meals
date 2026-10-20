import "server-only";

import { classifyRecipe, type Organizer } from "./domain/taxonomy";
import { RetryableError, UserFacingError } from "./errors";
import { isMealieUnavailable } from "./mealie/client";
import {
  findRecipeBySourceUrl,
  getAiSettings,
  getRawRecipe,
  importRecipeFromUrl,
  importRecipeWithAi,
  patchRecipe,
} from "./mealie/import";
import { IMPORT_EXTRAS, withImportState } from "./mealie/import-state";
import {
  MACRO_KEYS,
  normaliseNutrition,
  NUTRITION_FIELDS,
} from "./mealie/nutrition";
import { createRateLimiter } from "./rate-limit";

export type ImportResult =
  | { status: "imported"; slug: string }
  | { status: "exists"; slug: string; name: string };

type FetchedRecipe = {
  name?: string | null;
  nutrition?: Record<string, string | null> | null;
  extras?: Record<string, unknown> | null;
  recipeIngredient?:
    | {
        originalText?: string | null;
        note?: string | null;
        display?: string | null;
      }[]
    | null;
  tags?: unknown[] | null;
  recipeCategory?: unknown[] | null;
};

type ImportPatch = {
  extras: Record<string, string>;
  orgURL?: string;
  tags?: Organizer[];
  recipeCategory?: Organizer[];
};

type Deps = {
  find: (url: string) => Promise<{ slug: string; name: string } | null>;
  importFromUrl: (url: string) => Promise<string | null>;
  getRecipe: (slug: string) => Promise<FetchedRecipe | null>;
  patch: (slug: string, fields: ImportPatch) => Promise<void>;
  limiter: { hit: (key: string) => boolean };
  aiSettings: () => Promise<{
    aiEnabled: boolean;
    imageProviderEnabled: boolean;
  }>;
  importFromAi: (input: SocialInput) => Promise<string | null>;
};

export type SocialInput = {
  url: string;
  caption: string | null;
  images: File[];
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
  aiSettings: () => getAiSettings(),
  importFromAi: (input) => importRecipeWithAi(input),
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
  return guarded(url, userId, d, async () => {
    const existing = await findExisting(url, d);
    if (existing) {
      return existing;
    }
    const slug = await d.importFromUrl(url);
    if (!slug) {
      throw new UserFacingError("Couldn't find a recipe on that page.");
    }
    return markImported(slug, d);
  });
}

/**
 * Imports a recipe from an Instagram or Facebook post through Mealie's AI,
 * from the pasted caption and/or screenshots (Mealie can't read the post
 * itself). The caller makes sure there is at least one of them.
 */
export async function importSocialRecipe(
  input: SocialInput,
  userId: string,
  deps: Partial<Deps> = {}
): Promise<ImportResult> {
  const d = { ...defaults, ...deps };
  return guarded(input.url, userId, d, async () => {
    const existing = await findExisting(input.url, d);
    if (existing) {
      return existing;
    }
    const settings = await d.aiSettings();
    if (!settings.aiEnabled) {
      throw new UserFacingError(
        "Mealie has no AI provider set up. Add one in Mealie's group settings, then try again."
      );
    }
    if (input.images.length > 0 && !settings.imageProviderEnabled) {
      throw new UserFacingError(
        "Mealie has no AI provider for images. Paste the caption instead, or pick an image provider in Mealie's group settings."
      );
    }
    const slug = await d.importFromAi(input);
    if (!slug) {
      throw new UserFacingError(
        "Couldn't find a recipe in that caption or those screenshots."
      );
    }
    // Set explicitly so the source survives Mealie not copying the url.
    return markImported(slug, d, input.url);
  });
}

async function guarded(
  url: string,
  userId: string,
  d: Deps,
  run: () => Promise<ImportResult>
): Promise<ImportResult> {
  if (!d.limiter.hit(userId)) {
    throw new UserFacingError("Too many imports. Try again in a while.");
  }
  const running = inFlight.get(url);
  if (running) {
    return running;
  }
  const work = withRetry(run).finally(() => inFlight.delete(url));
  inFlight.set(url, work);
  return work;
}

async function findExisting(
  url: string,
  d: Deps
): Promise<ImportResult | null> {
  const existing = await d.find(url);
  if (!existing) {
    return null;
  }
  // An earlier import can create the recipe and still fail before
  // marking it (a timeout, a failed PATCH); this retry finishes the job.
  const recipe = await d.getRecipe(existing.slug);
  if (recipe && !(IMPORT_EXTRAS.review in (recipe.extras ?? {}))) {
    await markPending(existing.slug, recipe, d);
  }
  return { status: "exists", ...existing };
}

async function markImported(
  slug: string,
  d: Deps,
  orgURL?: string
): Promise<ImportResult> {
  const recipe = await d.getRecipe(slug);
  // Null: the recipe was deleted since the import, nothing left to mark.
  if (recipe) {
    await markPending(slug, recipe, d, orgURL);
  }
  return { status: "imported", slug };
}

async function withRetry(run: () => Promise<ImportResult>) {
  try {
    return await run();
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

async function markPending(
  slug: string,
  recipe: FetchedRecipe,
  d: Deps,
  orgURL?: string
) {
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
    ...(orgURL ? { orgURL } : {}),
    ...organizersFor(recipe),
  });
}

/**
 * Tags and categories from the agreed list, worked out from the recipe
 * itself. Mealie's own `includeTags` would copy whatever keywords the page
 * uses. A recipe that already has some (tagged by hand before a retried
 * import finished) keeps them.
 */
function organizersFor(
  recipe: FetchedRecipe
): Pick<ImportPatch, "tags" | "recipeCategory"> {
  if (recipe.tags?.length || recipe.recipeCategory?.length) {
    return {};
  }
  const { tags, categories } = classifyRecipe({
    name: recipe.name ?? "",
    ingredients: (recipe.recipeIngredient ?? []).map(
      (i) => i.originalText || i.note || i.display || ""
    ),
    proteinPerServing: normaliseNutrition(recipe.nutrition).perServing.protein,
  });
  return {
    ...(tags.length > 0 ? { tags } : {}),
    ...(categories.length > 0 ? { recipeCategory: categories } : {}),
  };
}

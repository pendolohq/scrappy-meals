import "server-only";

import { getDb } from "./db/client";
import { parseBarcode } from "./domain/barcode";
import { offHasGaps } from "./domain/off-contribution";
import {
  draftFromOff,
  offImageUrl,
  offProductUrl,
  perServing,
  type ProductDraft,
  type ProductInfo,
  type ServingUnit,
} from "./domain/product";
import { PRODUCT_TAG } from "./domain/taxonomy";
import { RetryableError, UserFacingError } from "./errors";
import { isMealieUnavailable } from "./mealie/client";
import type { Macros, RecipeNutrition } from "./mealie/nutrition";
import {
  createProductRecipe,
  findProductByBarcode,
  type ProductRecipeInput,
  setRecipeImageFromUrl,
} from "./mealie/products";
import { getRecipe, type Recipe } from "./mealie/recipes";
import { contributionEnabled } from "./off-contribute";
import { lookupOpenFoodFacts, type OffResult } from "./openfoodfacts";
import { createRateLimiter } from "./rate-limit";
import { loadRecipes } from "./recipe-cache";

export class ProductError extends UserFacingError {
  name = "ProductError";
}

export type KnownProduct = {
  status: "known";
  slug: string;
  name: string;
  info: ProductInfo;
  nutrition: RecipeNutrition;
};

export type ProductLookup =
  | KnownProduct
  | { status: "draft"; draft: ProductDraft; canContribute: boolean }
  | { status: "not-found"; barcode: string; canContribute: boolean };

export type SaveProductInput = {
  barcode: string;
  name: string;
  servingGrams: number;
  servingUnit: ServingUnit;
  packGrams: number | null;
  per100: Partial<Macros>;
  fromOpenFoodFacts: boolean;
  /** Someone changed a value from what Open Food Facts had. */
  edited: boolean;
  /** Open Food Facts' front photo, from the draft; checked again here. */
  imageUrl?: string | null;
};

type Deps = {
  find: (barcode: string) => Promise<Recipe | null>;
  getRecipe: (slug: string) => Promise<Recipe | null>;
  create: (input: ProductRecipeInput) => Promise<string>;
  lookupOff: (barcode: string) => Promise<OffResult>;
  limiter: { hit: (key: string) => boolean };
  /** Whether the app can send products to Open Food Facts. */
  canContribute: () => boolean;
};

// Every lookup leaves from the server's address, and Open Food Facts allows 15
// product reads a minute from one; so the household shares 10.
const limiter = createRateLimiter({ limit: 10, windowMs: 60 * 1000 });
const LIMITER_KEY = "off";

const defaults: Deps = {
  find: (barcode) => findProductByBarcode(barcode),
  getRecipe: (slug) => getRecipe(slug),
  create: (input) => createProductRecipe(input),
  lookupOff: (barcode) => lookupOpenFoodFacts(barcode),
  limiter,
  canContribute: contributionEnabled,
};

const withDefaults = (deps: Partial<Deps>): Deps => ({
  find: deps.find ?? defaults.find,
  getRecipe: deps.getRecipe ?? defaults.getRecipe,
  create: deps.create ?? defaults.create,
  lookupOff: deps.lookupOff ?? defaults.lookupOff,
  limiter: deps.limiter ?? defaults.limiter,
  canContribute: deps.canContribute ?? defaults.canContribute,
});

const canonical = (input: string): string => {
  const barcode = parseBarcode(input);
  if (!barcode) {
    throw new ProductError(
      "That doesn't look like a barcode: it should be 8 to 14 digits"
    );
  }
  return barcode;
};

/** Mealie being down is worth a retry; the barcode stays in the field. */
async function inMealie<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (isMealieUnavailable(err)) {
      throw new RetryableError(
        "Mealie isn't reachable right now. Try again in a moment."
      );
    }
    throw err;
  }
}

/** A product recipe as the sheet shows it; refuses one whose extras are unreadable. */
function knownProduct(recipe: Recipe): KnownProduct {
  if (!recipe.product) {
    const tagged = recipe.tags.some((t) => t.slug === PRODUCT_TAG.slug);
    if (!tagged) {
      throw new ProductError("That isn't a product");
    }
    throw new ProductError(
      "That product is incomplete in Mealie. Fix it there, or remove it."
    );
  }
  return {
    status: "known",
    slug: recipe.slug,
    name: recipe.name,
    info: recipe.product,
    nutrition: recipe.nutrition,
  };
}

/** A product already in Mealie, by slug (picked from search or recent products). */
export async function loadKnownProduct(
  slug: string,
  deps: Partial<Deps> = {}
): Promise<KnownProduct> {
  const d = withDefaults(deps);
  const recipe = await inMealie(() => d.getRecipe(slug));
  if (!recipe) {
    throw new ProductError("That product is no longer in Mealie");
  }
  return knownProduct(recipe);
}

/**
 * What a barcode is: a product already in Mealie, a draft from Open Food
 * Facts for the user to check, or unknown to both.
 */
export async function lookupProduct(
  input: string,
  deps: Partial<Deps> = {}
): Promise<ProductLookup> {
  const d = withDefaults(deps);
  const barcode = canonical(input);

  const found = await inMealie(() => d.find(barcode));
  if (found) {
    return knownProduct(found);
  }

  if (!d.limiter.hit(LIMITER_KEY)) {
    throw new ProductError("Too many lookups; wait a minute and try again");
  }
  const off = await d.lookupOff(barcode);
  const enabled = d.canContribute();
  return off.status === "found"
    ? {
        status: "draft",
        draft: draftFromOff(barcode, off.product),
        // Nothing to offer when Open Food Facts already has it all.
        canContribute: enabled && offHasGaps(off.product),
      }
    : { status: "not-found", barcode, canContribute: enabled };
}

/**
 * Saves a checked product as a Mealie recipe and returns its slug. A barcode
 * that is already there (saved meanwhile from another device) gets the
 * existing recipe, not a second one, and what was typed here is dropped.
 */
export async function saveProduct(
  input: SaveProductInput,
  deps: Partial<Deps> = {}
): Promise<{ slug: string; photoUrl: string | null }> {
  const d = withDefaults(deps);
  const barcode = canonical(input.barcode);

  return inMealie(async () => {
    const existing = await d.find(barcode);
    if (existing) {
      // An incomplete one would be planned as an ordinary recipe for everyone.
      return { slug: knownProduct(existing).slug, photoUrl: null };
    }
    const slug = await d.create({
      name: input.name,
      info: {
        barcode,
        servingGrams: input.servingGrams,
        servingUnit: input.servingUnit,
        packGrams: input.packGrams,
      },
      perServing: perServing(input.per100, input.servingGrams),
      orgURL: input.fromOpenFoodFacts ? offProductUrl(barcode) : null,
      nutrition:
        input.edited || !input.fromOpenFoodFacts ? "reviewed" : "source",
    });
    // The browser sends it back, so it is only trusted as far as the allow-list.
    const photoUrl = input.fromOpenFoodFacts
      ? offImageUrl(input.imageUrl)
      : null;
    return { slug, photoUrl };
  });
}

/**
 * Has Mealie fetch a new product's photo. Meant to run after the response
 * (`after()`): Mealie can take seconds to give up on an unreachable image, and
 * the product is saved without it. Failures are only logged.
 */
export async function attachProductPhoto(
  slug: string,
  url: string,
  deps: {
    setImage?: (slug: string, url: string) => Promise<void>;
    refresh?: (slug: string) => Promise<unknown>;
  } = {}
): Promise<void> {
  const setImage = deps.setImage ?? setRecipeImageFromUrl;
  // Adding the meal cached the recipe without the photo; without this it
  // would only show after the hourly refresh.
  const refresh =
    deps.refresh ?? ((s: string) => loadRecipes(getDb(), [s], { force: true }));
  try {
    await setImage(slug, url);
  } catch (err) {
    console.warn(`Product ${slug}: could not fetch its image`, err);
    return;
  }
  try {
    await refresh(slug);
  } catch (err) {
    console.warn(`Product ${slug}: could not refresh its cached recipe`, err);
  }
}

import "server-only";

import type { ProductInfo } from "../domain/product";
import { PRODUCT_TAG } from "../domain/taxonomy";

import { type MealieClient, mealie, unwrap } from "./client";
import { getRawRecipe, patchRecipe } from "./import";
import { withImportState } from "./import-state";
import { MACRO_KEYS, type Macros, NUTRITION_FIELDS } from "./nutrition";
import { PRODUCT_EXTRAS, withProductState } from "./product-state";

export type ProductRecipeInput = {
  name: string;
  info: ProductInfo;
  /** Nutrition for one serving, only the macros that are known. */
  perServing: Partial<Macros>;
  /** The Open Food Facts page, when the data came from there. */
  orgURL: string | null;
  /** `reviewed` when someone changed a value or typed it in. */
  nutrition: "source" | "reviewed";
};

/**
 * Creates the Mealie recipe for a packaged product and returns its slug. One
 * serving is the product's own, so `recipeServings` is 1 and the nutrition is
 * per that serving.
 */
export async function createProductRecipe(
  input: ProductRecipeInput,
  opts: { client?: MealieClient } = {}
): Promise<string> {
  const client = opts.client ?? mealie();
  const slug = unwrap(
    await client.POST("/api/recipes", { body: { name: input.name } })
  );
  const { servingGrams, servingUnit } = input.info;
  await patchRecipe(
    slug,
    {
      // A new recipe comes with a sample ingredient and step; a product has
      // none, and an ingredient would land on the shopping list.
      recipeIngredient: [],
      recipeInstructions: [],
      recipeServings: 1,
      recipeYield: `1 serving (${servingGrams} ${servingUnit})`,
      nutrition: Object.fromEntries(
        MACRO_KEYS.flatMap((macro) => {
          const value = input.perServing[macro];
          return value === undefined
            ? []
            : [[NUTRITION_FIELDS[macro], String(value)]];
        })
      ),
      ...(input.orgURL ? { orgURL: input.orgURL } : {}),
      tags: [{ name: PRODUCT_TAG.name }],
      extras: withImportState(withProductState({}, input.info), {
        review: "done",
        nutrition: input.nutrition,
      }),
    },
    { client }
  );
  return slug;
}

const MAX_CANDIDATES = 5;

/**
 * The product recipe with this barcode (canonical form), if any. Mealie's
 * filter on `extras.key_name = X AND extras.value = Y` can match two
 * different extras of one recipe, so it filters on the value alone and the
 * recipe's own `scrappyProduct` has the last word.
 */
export async function findProductByBarcode(
  barcode: string,
  opts: { client?: MealieClient } = {}
): Promise<{ slug: string; name: string } | null> {
  // The filter syntax has no escape for quotes; digits never need one.
  if (!/^\d+$/.test(barcode)) {
    throw new Error("barcode must be digits only");
  }
  const client = opts.client ?? mealie();
  const page = unwrap(
    await client.GET("/api/recipes", {
      params: {
        query: {
          queryFilter: `extras.value = "${barcode}"`,
          perPage: MAX_CANDIDATES,
        },
      },
    })
  );
  for (const hit of page.items) {
    if (!hit.slug) {
      continue;
    }
    const recipe = await getRawRecipe(hit.slug, { client });
    if (recipe?.extras?.[PRODUCT_EXTRAS.barcode] === barcode) {
      return { slug: hit.slug, name: recipe.name || hit.slug };
    }
  }
  return null;
}

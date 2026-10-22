import "server-only";

import type { ProductInfo } from "../domain/product";
import { PRODUCT_TAG } from "../domain/taxonomy";

import { type MealieClient, mealie, unwrap } from "./client";
import { getRawRecipe, patchRecipe } from "./import";
import { withImportState } from "./import-state";
import { MACRO_KEYS, type Macros, NUTRITION_FIELDS } from "./nutrition";
import { PRODUCT_EXTRAS, withProductState } from "./product-state";
import { type Recipe, toRecipe } from "./recipes";

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
  try {
    await fillProductRecipe(slug, input, client);
  } catch (err) {
    // Half made, it would be an untagged recipe with Mealie's sample
    // ingredient that the barcode can't find, so a retry would make another.
    await client
      .DELETE("/api/recipes/{slug}", { params: { path: { slug } } })
      .catch(() => undefined);
    throw err;
  }
  return slug;
}

async function fillProductRecipe(
  slug: string,
  input: ProductRecipeInput,
  client: MealieClient
): Promise<void> {
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
}

/**
 * The product recipe with this barcode (canonical form), if any. Mealie's
 * filter on `extras.key_name = X AND extras.value = Y` can match two
 * different extras of one recipe, so it filters on the value alone and the
 * recipe's own `scrappyProduct` has the last word. Every match is checked, so
 * other recipes sharing the value can't hide the product. Its `product` is
 * null when the rest of its extras are unreadable.
 */
export async function findProductByBarcode(
  barcode: string,
  opts: { client?: MealieClient } = {}
): Promise<Recipe | null> {
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
          // -1 is Mealie's "everything"; a barcode is rarely another value.
          perPage: -1,
        },
      },
    })
  );
  const candidates = await Promise.all(
    page.items.flatMap((hit) =>
      hit.slug ? [getRawRecipe(hit.slug, { client })] : []
    )
  );
  const match = candidates.find(
    (recipe) => recipe?.extras?.[PRODUCT_EXTRAS.barcode] === barcode
  );
  return match ? toRecipe(match) : null;
}

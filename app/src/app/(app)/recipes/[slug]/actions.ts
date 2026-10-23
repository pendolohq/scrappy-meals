"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { userAction } from "@/server/action";
import { getDb } from "@/server/db/client";
import { parseBarcode } from "@/server/domain/barcode";
import { recipeSlug } from "@/server/domain/recipe-slug";
import { UserFacingError } from "@/server/errors";
import { retryContribution } from "@/server/off-contribute";
import { setNoShopping } from "@/server/recipe-shopping";

/** Sends a product that Open Food Facts didn't take the first time again. */
export const retryContributionAction = userAction(
  z.object({ barcode: z.string().max(32) }),
  async ({ barcode: input }, user) => {
    const barcode = parseBarcode(input);
    if (!barcode) {
      throw new UserFacingError("That doesn't look like a barcode");
    }
    const outcome = await retryContribution(getDb(), barcode, user.id);
    revalidatePath("/recipes/[slug]", "page");
    revalidatePath("/week/[weekStart]/meals/[mealId]", "page");
    return { outcome };
  }
);

/**
 * Keeps a recipe off the shopping list, or puts it back. Household-wide, like
 * the list itself.
 */
export const setNoShoppingAction = userAction(
  z.object({ slug: recipeSlug, noShopping: z.boolean() }),
  async ({ slug, noShopping }) => {
    await setNoShopping(slug, noShopping);
    revalidatePath("/recipes/[slug]", "page");
    revalidatePath("/week/[weekStart]", "layout");
    return { noShopping };
  }
);

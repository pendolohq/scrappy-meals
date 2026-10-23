import "server-only";

import { getDb } from "./db/client";
import { UserFacingError } from "./errors";
import { getRawRecipe, patchRecipe } from "./mealie/import";
import { withNoShopping } from "./mealie/shopping-state";
import { loadRecipes } from "./recipe-cache";
import { whenMealieAnswers } from "./recipe-review";

type Deps = {
  getRecipe: (
    slug: string
  ) => Promise<{ extras?: Record<string, unknown> | null } | null>;
  patch: (slug: string, extras: Record<string, string>) => Promise<void>;
  refresh: (slug: string) => Promise<void>;
};

const defaults = (): Deps => ({
  getRecipe: (slug) => getRawRecipe(slug),
  patch: (slug, extras) => patchRecipe(slug, { extras }),
  refresh: async (slug) => {
    await loadRecipes(getDb(), [slug], { force: true });
  },
});

/**
 * Keeps a recipe off the shopping list, or puts it back: the flag is in its
 * Mealie extras, and the cached copy the list reads is refreshed at once.
 */
export async function setNoShopping(
  slug: string,
  on: boolean,
  deps: Partial<Deps> = {}
): Promise<void> {
  const d = { ...defaults(), ...deps };
  await whenMealieAnswers(async () => {
    const recipe = await d.getRecipe(slug);
    if (!recipe) {
      throw new UserFacingError("That recipe no longer exists in Mealie.");
    }
    await d.patch(slug, withNoShopping(recipe.extras, on));
    await d.refresh(slug);
  });
}

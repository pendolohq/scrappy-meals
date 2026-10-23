import "server-only";

import {
  type FoodServing,
  LINE_UNITS,
  type LineFood,
  servingLabel,
} from "../domain/food";
import { FOOD_TAG } from "../domain/taxonomy";

import { type MealieClient, mealie, unwrap } from "./client";
import { withFoodState } from "./food-state";
import { findOrCreateUnit, findUnit, patchRecipe } from "./import";
import { withImportState } from "./import-state";
import { MACRO_KEYS, type Macros, NUTRITION_FIELDS } from "./nutrition";
import { foodDensity } from "./recipes";

export type FoodRecipeInput = {
  name: string;
  food: { id: string; name: string };
  serving: FoodServing;
  /** Nutrition for one serving, only the macros that are known. */
  perServing: Partial<Macros>;
  /** `source` when counted from USDA; `estimated` by Claude; `reviewed` when typed or edited. */
  nutrition: "source" | "estimated" | "reviewed";
};

const toFood = (f: {
  id: string;
  name: string;
  extras?: Record<string, unknown> | null;
}): LineFood => ({ id: f.id, name: f.name, gramsPerMl: foodDensity(f.extras) });

/** Mealie's foods whose name (or plural, alias…) has the words, as Mealie searches. */
export async function searchFoods(
  query: string,
  opts: { limit?: number; client?: MealieClient } = {}
): Promise<LineFood[]> {
  const client = opts.client ?? mealie();
  const page = unwrap(
    await client.GET("/api/foods", {
      params: {
        query: { search: query.trim(), page: 1, perPage: opts.limit ?? 5 },
      },
    })
  );
  return page.items.map(toFood);
}

/** The Mealie food with this id; null when it's gone. */
export async function getFood(
  id: string,
  opts: { client?: MealieClient } = {}
): Promise<LineFood | null> {
  const client = opts.client ?? mealie();
  const result = await client.GET("/api/foods/{item_id}", {
    params: { path: { item_id: id } },
  });
  if (result.response.status === 404) {
    return null;
  }
  return toFood(unwrap(result));
}

/**
 * The unit for grams or millilitres: the one Mealie already has by its
 * abbreviation ("g"; ours locally is named "millilitre"), else one created by
 * the name Mealie knows the standard of, so the line converts.
 */
async function lineUnit(
  unit: "g" | "ml",
  client: MealieClient
): Promise<{ id: string; name: string }> {
  const { abbreviation, name } = LINE_UNITS[unit];
  return (
    (await findUnit(abbreviation, { client })) ??
    (await findOrCreateUnit(name, { client }))
  );
}

/**
 * Creates the Mealie recipe for a single food and returns its slug: one
 * ingredient line, one serving, tagged Food, with the nutrition of that
 * serving.
 */
export async function createFoodRecipe(
  input: FoodRecipeInput,
  opts: { client?: MealieClient } = {}
): Promise<string> {
  const client = opts.client ?? mealie();
  const unit =
    input.serving.unit === "piece"
      ? null
      : await lineUnit(input.serving.unit, client);
  const slug = unwrap(
    await client.POST("/api/recipes", { body: { name: input.name } })
  );
  try {
    await patchRecipe(
      slug,
      {
        // Replaces the sample ingredient and step a new recipe comes with.
        recipeIngredient: [
          {
            quantity: input.serving.amount,
            unit,
            food: input.food,
            note: "",
          },
        ],
        recipeInstructions: [],
        recipeServings: 1,
        recipeYield: `1 serving (${servingLabel(input.serving)})`,
        nutrition: Object.fromEntries(
          MACRO_KEYS.flatMap((macro) => {
            const value = input.perServing[macro];
            return value === undefined
              ? []
              : [[NUTRITION_FIELDS[macro], String(value)]];
          })
        ),
        tags: [{ name: FOOD_TAG.name }],
        extras: withImportState(
          withFoodState({}, { ...input.serving, foodId: input.food.id }),
          { review: "done", nutrition: input.nutrition }
        ),
      },
      { client }
    );
  } catch (err) {
    // Half made, it would be an untagged recipe with Mealie's sample
    // ingredient, planned like a dish.
    await client
      .DELETE("/api/recipes/{slug}", { params: { path: { slug } } })
      .catch(() => undefined);
    throw err;
  }
  return slug;
}

import "server-only";

import {
  type FoodServing,
  LINE_UNITS,
  type LineFood,
  servingLabel,
} from "../domain/food";
import { FOOD_TAG } from "../domain/taxonomy";

import { type MealieClient, mealie, unwrap } from "./client";
import { type FoodState, readFoodState, withFoodState } from "./food-state";
import { getRawRecipe, patchRecipe } from "./import";
import { readImportState, withImportState } from "./import-state";
import {
  MACRO_KEYS,
  type Macros,
  normaliseNutrition,
  NUTRITION_FIELDS,
} from "./nutrition";
import { foodDensity, type Ingredient, listFoodRecipes } from "./recipes";
import { readNoShopping, withNoShopping } from "./shopping-state";

export type FoodRecipeInput = {
  name: string;
  food: { id: string; name: string };
  /** Mealie's gram or millilitre unit (`findLineUnit`); null for pieces. */
  unit: { id: string; name: string } | null;
  serving: FoodServing;
  /** Nutrition for one serving, only the macros that are known. */
  perServing: Partial<Macros>;
  /** `source` when counted from USDA; `estimated` by Claude; `reviewed` when typed or edited. */
  nutrition: "source" | "estimated" | "reviewed";
  /** Leave it off the shopping list (a cappuccino from the café). */
  noShopping: boolean;
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
 * Mealie's unit for grams or millilitres: one whose standard is exactly a gram
 * (or millilitre), the one with the usual abbreviation first ("g"; ours
 * locally is named "millilitre"). Else one is created by the name Mealie knows
 * the standard of. Null when even that one has no standard: the line wouldn't
 * convert.
 */
export async function findLineUnit(
  unit: "g" | "ml",
  opts: { client?: MealieClient } = {}
): Promise<NonNullable<Ingredient["unit"]> | null> {
  const client = opts.client ?? mealie();
  const { abbreviation, name, standardUnit } = LINE_UNITS[unit];
  const exact = (u: MealieUnit) =>
    u.standardUnit === standardUnit && u.standardQuantity === 1;
  const all = unwrap(
    await client.GET("/api/units", { params: { query: { perPage: -1 } } })
  ).items.filter(exact);
  const found =
    all.find((u) => u.abbreviation?.trim().toLowerCase() === abbreviation) ??
    all[0];
  if (found) {
    return toUnit(found);
  }
  const created = unwrap(
    await client.POST("/api/units", { body: { name, abbreviation } })
  );
  return exact(created) ? toUnit(created) : null;
}

type MealieUnit = {
  id: string;
  name: string;
  abbreviation?: string;
  standardQuantity?: number | null;
  standardUnit?: string | null;
};

const toUnit = (u: MealieUnit): NonNullable<Ingredient["unit"]> => ({
  id: u.id,
  name: u.name,
  abbreviation: u.abbreviation ?? "",
  standardQuantity: u.standardQuantity ?? null,
  standardUnit: u.standardUnit ?? null,
});

/** "Kiwi (2)" is how Mealie names a second recipe called "Kiwi". */
const baseName = (name: string) =>
  name
    .replace(/\s*\(\d+\)\s*$/, "")
    .trim()
    .toLowerCase();

/**
 * A single food recipe named `name` (any case, or as Mealie renames a second
 * one: "Kiwi (2)") with this serving of this food and this nutrition per
 * serving, from the same source; its slug, or null. Saving the same food
 * again reuses it, so a retry or a second add doesn't make "Kiwi (1)".
 */
export async function findFoodRecipe(
  name: string,
  state: FoodState,
  perServing: Partial<Macros>,
  nutrition: FoodRecipeInput["nutrition"],
  opts: { client?: MealieClient } = {}
): Promise<{ slug: string; noShopping: boolean } | null> {
  const client = opts.client ?? mealie();
  const wanted = baseName(name);
  // Every match: Mealie's search is fuzzy, so the one saved before may rank
  // below other foods with a similar name.
  const { items } = await listFoodRecipes({
    search: name,
    perPage: -1,
    client,
  });
  for (const item of items) {
    if (baseName(item.name) !== wanted) {
      continue;
    }
    const raw = await getRawRecipe(item.slug, { client });
    const found = readFoodState(raw?.extras);
    const values = normaliseNutrition(raw?.nutrition).perServing;
    if (
      found &&
      readImportState(raw?.extras).nutrition === nutrition &&
      MACRO_KEYS.every((m) => values[m] === perServing[m]) &&
      found.foodId === state.foodId &&
      found.unit === state.unit &&
      found.amount === state.amount &&
      found.grams === state.grams
    ) {
      return { slug: item.slug, noShopping: readNoShopping(raw?.extras) };
    }
  }
  return null;
}

export async function deleteRecipe(
  slug: string,
  opts: { client?: MealieClient } = {}
): Promise<void> {
  const client = opts.client ?? mealie();
  unwrap(
    await client.DELETE("/api/recipes/{slug}", { params: { path: { slug } } })
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
  const unit = input.unit && { id: input.unit.id, name: input.unit.name };
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
          withNoShopping(
            withFoodState({}, { ...input.serving, foodId: input.food.id }),
            input.noShopping
          ),
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

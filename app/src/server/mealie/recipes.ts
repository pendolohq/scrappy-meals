import "server-only";

import { type MealieClient, mealie, unwrap } from "./client";
import { type ImportState, readImportState } from "./import-state";
import { normaliseNutrition, type RecipeNutrition } from "./nutrition";
import type { components } from "./schema";

type MealieRecipe = components["schemas"]["Recipe-Output"];
type MealieSummary = components["schemas"]["RecipeSummary"];
type MealieIngredient = components["schemas"]["RecipeIngredient-Output"];
type MealieStep = components["schemas"]["RecipeStep"];
type MealieNote = components["schemas"]["RecipeNote"];

export type RecipeListItem = {
  id: string | null;
  slug: string;
  name: string;
  /** Mealie media path, e.g. /api/media/recipes/<id>/images/min-original.webp */
  imagePath: string | null;
  servings: number | null;
};

export type Ingredient = {
  /** Null when Mealie has no amount (unparsed line, or "to taste"). */
  quantity: number | null;
  food: { id: string; name: string } | null;
  unit: { id: string; name: string; abbreviation: string } | null;
  note: string;
  /** Mealie's rendered line, e.g. "2 cups flour, sifted". */
  display: string;
  /** Section heading shown above this line ("For the sauce"). */
  title?: string | null;
};

export type RecipeStep = {
  /** Section heading shown above this step ("For the sauce"). */
  title: string | null;
  text: string;
};

export type RecipeNote = { title: string; text: string };

export type Recipe = RecipeListItem & {
  id: string;
  nutrition: RecipeNutrition;
  ingredients: Ingredient[];
  instructions: RecipeStep[];
  notes: RecipeNote[];
  /** The page or post the recipe was imported from (Mealie's orgURL). */
  sourceUrl: string | null;
  importState: ImportState;
};

export type RecipePage = { items: RecipeListItem[] };

export async function searchRecipes(
  query: string,
  opts: { perPage?: number; client?: MealieClient } = {}
): Promise<RecipePage> {
  const client = opts.client ?? mealie();
  const search = query.trim();
  const page = unwrap(
    await client.GET("/api/recipes", {
      params: {
        query: {
          search: search || undefined,
          // Mealie ranks by relevance when searching; otherwise list alphabetically.
          ...(search
            ? {}
            : { orderBy: "name", orderDirection: "asc" as const }),
          page: 1,
          perPage: opts.perPage ?? 20,
        },
      },
    })
  );
  return {
    items: page.items.map(toListItem),
  };
}

/** Full recipe with normalised nutrition and ingredients; null if the slug doesn't exist. */
export async function getRecipe(
  slug: string,
  opts: { client?: MealieClient } = {}
): Promise<Recipe | null> {
  const client = opts.client ?? mealie();
  const result = await client.GET("/api/recipes/{slug}", {
    params: { path: { slug } },
  });
  if (result.response.status === 404) {
    return null;
  }
  return toRecipe(unwrap(result));
}

export function toRecipe(r: MealieRecipe): Recipe {
  if (!r.id) {
    throw new Error(`Mealie recipe ${r.slug} has no id`);
  }
  return {
    ...toListItem(r),
    id: r.id,
    nutrition: normaliseNutrition(r.nutrition),
    ingredients: (r.recipeIngredient ?? []).map(toIngredient),
    instructions: (r.recipeInstructions ?? []).flatMap(toStep),
    notes: (r.notes ?? []).flatMap(toNote),
    sourceUrl: r.orgURL || null,
    importState: readImportState(r.extras),
  };
}

function toListItem(r: MealieSummary | MealieRecipe): RecipeListItem {
  return {
    id: r.id ?? null,
    slug: r.slug ?? "",
    name: r.name || r.slug || "Untitled",
    imagePath:
      r.id && r.image
        ? `/api/media/recipes/${r.id}/images/min-original.webp`
        : null,
    // recipeYield is free text ("1 loaf"), so only recipeServings counts as servings.
    servings:
      r.recipeServings && r.recipeServings > 0 ? r.recipeServings : null,
  };
}

function toIngredient(i: MealieIngredient): Ingredient {
  const food =
    i.food && "id" in i.food && i.food.id
      ? { id: i.food.id, name: i.food.name }
      : null;
  const unit =
    i.unit && "id" in i.unit && i.unit.id
      ? {
          id: i.unit.id,
          name: i.unit.name,
          abbreviation: i.unit.abbreviation ?? "",
        }
      : null;
  return {
    quantity: i.quantity ? i.quantity : null,
    food,
    unit,
    note: i.note ?? "",
    display: i.display || i.originalText || i.note || "",
    title: i.title?.trim() || null,
  };
}

function toStep(s: MealieStep): RecipeStep[] {
  const title = s.title?.trim() || null;
  const text = s.text.trim();
  return title || text ? [{ title, text }] : [];
}

function toNote(n: MealieNote): RecipeNote[] {
  const title = n.title.trim();
  const text = n.text.trim();
  return title || text ? [{ title, text }] : [];
}

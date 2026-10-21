import "server-only";

import { parseDecimal } from "../domain/decimal";
import { nextDiscoverPage } from "../domain/discover";
import type { ProductInfo } from "../domain/product";
import {
  categoryFilter,
  type Organizer,
  PRODUCT_TAG,
  QUICK_MAX_MINUTES,
} from "../domain/taxonomy";

import { type MealieClient, mealie, unwrap } from "./client";
import { type ImportState, readImportState } from "./import-state";
import { normaliseNutrition, type RecipeNutrition } from "./nutrition";
import { readProductState } from "./product-state";
import type { components } from "./schema";

type MealieRecipe = components["schemas"]["Recipe-Output"];
type MealieSummary = components["schemas"]["RecipeSummary"];
type MealieIngredient = components["schemas"]["RecipeIngredient-Output"];
type MealieStep = components["schemas"]["RecipeStep"];
type MealieNote = components["schemas"]["RecipeNote"];

type RecipeSummaryFields = {
  id: string | null;
  slug: string;
  name: string;
  /** Mealie media path, e.g. /api/media/recipes/<id>/images/min-original.webp */
  imagePath: string | null;
  servings: number | null;
  /** Mealie's total time, rounded to minutes; null when not set. */
  totalMinutes: number | null;
};

export type RecipeListItem = RecipeSummaryFields & {
  /** Carries the Product tag: a packaged product rather than a dish. */
  isProduct: boolean;
};

export type Ingredient = {
  /** Null when Mealie has no amount (unparsed line, or "to taste"). */
  quantity: number | null;
  food: {
    id: string;
    name: string;
    /** Mealie's label for the food, which places it in a shop aisle. */
    label?: string | null;
    /**
     * Grams per millilitre, from the food's `scrappyGramsPerMl` extra, so the
     * shopping list can turn its volumes into grams.
     */
    gramsPerMl?: number | null;
  } | null;
  unit: {
    id: string;
    name: string;
    abbreviation: string;
    /** One unit is `standardQuantity` of Mealie's `standardUnit` ("gram", "cup"). */
    standardQuantity?: number | null;
    standardUnit?: string | null;
  } | null;
  note: string;
  /** Mealie's rendered line, e.g. "2 cups flour, sifted". */
  display: string;
  /** Section heading shown above this line ("For the sauce"). */
  title?: string | null;
  /**
   * What instruction steps link to (`RecipeStep.ingredientRefs`). Absent on
   * rows cached before links were kept.
   */
  referenceId?: string | null;
};

export type RecipeStep = {
  /** Section heading shown above this step ("For the sauce"). */
  title: string | null;
  text: string;
  /**
   * `referenceId`s of the ingredients linked to this step in Mealie. Absent
   * on rows cached before links were kept.
   */
  ingredientRefs?: string[];
};

export type RecipeNote = { title: string; text: string };

export type Recipe = RecipeSummaryFields & {
  id: string;
  nutrition: RecipeNutrition;
  ingredients: Ingredient[];
  instructions: RecipeStep[];
  notes: RecipeNote[];
  /** The page or post the recipe was imported from (Mealie's orgURL). */
  sourceUrl: string | null;
  importState: ImportState;
  tags: Organizer[];
  categories: Organizer[];
  /** Set for a packaged product: its barcode and what one serving is. */
  product: ProductInfo | null;
};

export type RecipePage = { items: RecipeListItem[] };

export type DiscoverFilters = {
  /** Tag slugs; a recipe needs all of them. */
  tags: string[];
  /** Category slugs; a recipe needs any of them. */
  categories: string[];
  /** Total time of 30 minutes or less. */
  quick: boolean;
  /** Words in the name (or description, ingredients…, as Mealie searches). */
  search?: string;
};

export const DISCOVER_PAGE_SIZE = 48;

/**
 * Products are in Mealie as recipes tagged Product. Browsing with no tags and
 * no search leaves them out of the grid, so snack bars don't bury the recipes;
 * a tag filter or a search brings them back to where they can be found. (Mealie's
 * `NOT IN` also matches recipes with no tags at all.)
 */
function discoverQueryFilter(
  filters: DiscoverFilters,
  search: string | undefined
): string | undefined {
  const clauses = [];
  if (filters.quick) {
    clauses.push(
      `totalTimeSeconds > 0 AND totalTimeSeconds <= ${QUICK_MAX_MINUTES * 60}`
    );
  }
  if (filters.tags.length === 0 && !search) {
    clauses.push(`tags.slug NOT IN ["${PRODUCT_TAG.slug}"]`);
  }
  return clauses.length > 1
    ? clauses.map((c) => `(${c})`).join(" AND ")
    : clauses[0];
}

/**
 * Recipes matching the filters, by name, or by relevance when searching for
 * words. Every filter runs in Mealie: tags and categories by slug, "quick"
 * as a filter on the total time in seconds.
 * Callers pass only slugs that exist: Mealie drops a filter whose slugs it
 * doesn't know rather than matching nothing. With `fromStart`, it returns
 * pages 1 to `page` together, as a page opened at `?page=n` shows them.
 */
export async function discoverRecipes(
  filters: DiscoverFilters,
  opts: { page?: number; fromStart?: boolean; client?: MealieClient } = {}
): Promise<{
  items: RecipeListItem[];
  total: number;
  /** The page "Load more" fetches next; null when there are no more. */
  nextPage: number | null;
}> {
  const client = opts.client ?? mealie();
  const page = opts.page ?? 1;
  const categories = categoryFilter(filters.categories);
  const search = filters.search?.trim();
  const result = unwrap(
    await client.GET("/api/recipes", {
      params: {
        query: {
          tags: filters.tags.length > 0 ? filters.tags : undefined,
          requireAllTags: true,
          categories: categories.length > 0 ? categories : undefined,
          requireAllCategories: false,
          queryFilter: discoverQueryFilter(filters, search),
          search: search || undefined,
          // Mealie ranks by relevance when searching; otherwise by name.
          ...(search
            ? {}
            : { orderBy: "name", orderDirection: "asc" as const }),
          page: opts.fromStart ? 1 : page,
          perPage: DISCOVER_PAGE_SIZE * (opts.fromStart ? page : 1),
        },
      },
    })
  );
  const total = result.total ?? result.items.length;
  return {
    items: result.items.map(toListItem),
    total,
    nextPage: nextDiscoverPage(page, total, DISCOVER_PAGE_SIZE),
  };
}

/** The products added most recently, newest first. */
export async function listProducts(
  opts: { perPage?: number; client?: MealieClient } = {}
): Promise<RecipePage> {
  const client = opts.client ?? mealie();
  const page = unwrap(
    await client.GET("/api/recipes", {
      params: {
        query: {
          tags: [PRODUCT_TAG.slug],
          orderBy: "dateAdded",
          orderDirection: "desc",
          page: 1,
          perPage: opts.perPage ?? 8,
        },
      },
    })
  );
  return { items: page.items.map(toListItem) };
}

export type OrganizerCount = Organizer & { recipeCount: number };

/** Every tag and category in Mealie, with how many recipes carry each. */
export async function listOrganizers(
  opts: { client?: MealieClient } = {}
): Promise<{ tags: OrganizerCount[]; categories: OrganizerCount[] }> {
  const client = opts.client ?? mealie();
  // perPage -1 is Mealie's "everything": a household has a few dozen at most.
  const query = {
    perPage: -1,
    orderBy: "name",
    orderDirection: "asc" as const,
  };
  const [tags, categories] = await Promise.all([
    client.GET("/api/organizers/tags", { params: { query } }),
    client.GET("/api/organizers/categories", { params: { query } }),
  ]);
  const counted = (o: {
    name: string;
    slug: string;
    recipeCount?: number;
  }) => ({
    name: o.name,
    slug: o.slug,
    recipeCount: o.recipeCount ?? 0,
  });
  return {
    tags: unwrap(tags).items.map(counted),
    categories: unwrap(categories).items.map(counted),
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
    ...toSummaryFields(r),
    id: r.id,
    nutrition: normaliseNutrition(r.nutrition),
    ingredients: (r.recipeIngredient ?? []).map(toIngredient),
    instructions: (r.recipeInstructions ?? []).flatMap(toStep),
    notes: (r.notes ?? []).flatMap(toNote),
    sourceUrl: r.orgURL || null,
    importState: readImportState(r.extras),
    tags: (r.tags ?? []).map(toOrganizer),
    categories: (r.recipeCategory ?? []).map(toOrganizer),
    product: readProductState(r.extras),
  };
}

const toOrganizer = (o: { name: string; slug: string }): Organizer => ({
  name: o.name,
  slug: o.slug,
});

const toListItem = (r: MealieSummary | MealieRecipe): RecipeListItem => ({
  ...toSummaryFields(r),
  isProduct: (r.tags ?? []).some((t) => t.slug === PRODUCT_TAG.slug),
});

function toSummaryFields(r: MealieSummary | MealieRecipe): RecipeSummaryFields {
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
    // Mealie keeps times as seconds; the older text field (`totalTime`) is
    // no longer filled in on import, and can't be filtered on.
    totalMinutes: r.totalTimeSeconds
      ? Math.max(1, Math.round(r.totalTimeSeconds / 60))
      : null,
  };
}

const DENSITY_EXTRA = "scrappyGramsPerMl";

/** Set by hand in Mealie, so anything but a plausible number counts as unset. */
function readDensity(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? parseDecimal(value, "refuse")
        : null;
  return n !== null && n > 0 && n < 25 ? n : null;
}

function toIngredient(i: MealieIngredient): Ingredient {
  const food =
    i.food && "id" in i.food && i.food.id
      ? {
          id: i.food.id,
          name: i.food.name,
          label: "label" in i.food ? (i.food.label?.name ?? null) : null,
          gramsPerMl: readDensity(i.food.extras?.[DENSITY_EXTRA]),
        }
      : null;
  const unit =
    i.unit && "id" in i.unit && i.unit.id
      ? {
          id: i.unit.id,
          name: i.unit.name,
          abbreviation: i.unit.abbreviation ?? "",
          standardQuantity: i.unit.standardQuantity ?? null,
          standardUnit: i.unit.standardUnit ?? null,
        }
      : null;
  return {
    quantity: i.quantity ? i.quantity : null,
    food,
    unit,
    note: i.note ?? "",
    display: i.display || i.originalText || i.note || "",
    title: i.title?.trim() || null,
    referenceId: i.referenceId ?? null,
  };
}

function toStep(s: MealieStep): RecipeStep[] {
  const title = s.title?.trim() || null;
  const text = s.text.trim();
  const ingredientRefs = [
    ...new Set(
      (s.ingredientReferences ?? []).flatMap((r) =>
        r.referenceId ? [r.referenceId] : []
      )
    ),
  ];
  return title || text ? [{ title, text, ingredientRefs }] : [];
}

function toNote(n: MealieNote): RecipeNote[] {
  const title = n.title.trim();
  const text = n.text.trim();
  return title || text ? [{ title, text }] : [];
}

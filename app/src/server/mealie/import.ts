import "server-only";

import {
  type MealieClient,
  mealie,
  mealieAiImporter,
  mealieImporter,
  unwrap,
} from "./client";
import type { components } from "./schema";

type RecipePatch = components["schemas"]["RecipeIn"];

/**
 * Asks Mealie to fetch the page and import the recipe on it. Returns the new
 * recipe's slug, or null when Mealie found no recipe there (it answers 400 for
 * pages it can't read, can't reach, or won't fetch, such as private addresses).
 */
export async function importRecipeFromUrl(
  url: string,
  opts: { client?: MealieClient } = {}
): Promise<string | null> {
  const client = opts.client ?? mealieImporter();
  const result = await client.POST("/api/recipes/create/url", {
    body: { url, includeTags: false, includeCategories: false },
  });
  if (result.response.status === 400) {
    return null;
  }
  return unwrap(result);
}

/**
 * Asks Mealie's AI to build a recipe from a pasted caption and/or screenshots,
 * with the post's address as its source. Returns the new recipe's slug, or
 * null when Mealie answered 400 (no recipe in the text, or no provider).
 */
export async function importRecipeWithAi(
  input: { url: string; caption: string | null; images: File[] },
  opts: { client?: MealieClient } = {}
): Promise<string | null> {
  const client = opts.client ?? mealieAiImporter();
  const result = await client.POST("/api/recipes/create/ai", {
    // The generated type can't describe files; the serializer builds the form.
    body: {
      url: input.url,
      ...(input.caption === null ? {} : { content: input.caption }),
      images: [],
    },
    bodySerializer: (body) => {
      const form = new FormData();
      if (body?.url) {
        form.set("url", body.url);
      }
      if (body?.content) {
        form.set("content", body.content);
      }
      for (const image of input.images) {
        form.append("images", image, image.name || "screenshot");
      }
      return form;
    },
  });
  if (result.response.status === 400) {
    return null;
  }
  return unwrap(result);
}

/** The group's AI provider settings: whether AI, and image input, work. */
export async function getAiSettings(
  opts: { client?: MealieClient } = {}
): Promise<{ aiEnabled: boolean; imageProviderEnabled: boolean }> {
  const client = opts.client ?? mealie();
  // Read from the group, not /api/groups/ai-providers/settings: that one needs
  // group-manage permission, which the planner's token deliberately lacks.
  const settings = unwrap(
    await client.GET("/api/groups/self")
  ).aiProviderSettings;
  return {
    aiEnabled: settings?.aiEnabled ?? false,
    imageProviderEnabled: settings?.imageProviderEnabled ?? false,
  };
}

/** A recipe already imported from this URL (Mealie's orgURL), if any. */
export async function findRecipeBySourceUrl(
  url: string,
  opts: { client?: MealieClient } = {}
): Promise<{ slug: string; name: string } | null> {
  // Mealie's filter syntax has no escape for quotes; a normalised URL
  // (new URL().href) never contains one.
  if (url.includes('"')) {
    throw new Error("source URL must not contain a quote");
  }
  const client = opts.client ?? mealie();
  const page = unwrap(
    await client.GET("/api/recipes", {
      params: { query: { queryFilter: `orgURL = "${url}"`, perPage: 1 } },
    })
  );
  const [first] = page.items;
  return first?.slug
    ? { slug: first.slug, name: first.name || first.slug }
    : null;
}

export type ParsedLine = {
  input: string;
  /** Null when the parser found no amount. */
  quantity: number | null;
  /** Null id: the parser recognised a name Mealie has no unit or food for yet. */
  unit: { id: string | null; name: string } | null;
  food: { id: string | null; name: string } | null;
  note: string;
  /** The parser's average confidence, 0–1. */
  confidence: number;
};

/** Runs ingredient lines through Mealie's NLP parser, in order. */
export async function parseIngredients(
  lines: string[],
  opts: { client?: MealieClient } = {}
): Promise<ParsedLine[]> {
  if (lines.length === 0) {
    return [];
  }
  const client = opts.client ?? mealie();
  const parsed = unwrap(
    await client.POST("/api/parser/ingredients", {
      body: { parser: "nlp", ingredients: lines },
    })
  );
  return parsed.map((p, i) => {
    const ing = p.ingredient;
    return {
      input: p.input ?? lines[i],
      quantity: ing.quantity ? ing.quantity : null,
      unit: ing.unit ? { id: ing.unit.id ?? null, name: ing.unit.name } : null,
      food: ing.food ? { id: ing.food.id ?? null, name: ing.food.name } : null,
      note: ing.note ?? "",
      confidence: p.confidence?.average ?? 0,
    };
  });
}

/** Changes only the given fields; Mealie keeps the rest (unlike PUT). */
export async function patchRecipe(
  slug: string,
  fields: RecipePatch,
  opts: { client?: MealieClient } = {}
): Promise<void> {
  const client = opts.client ?? mealie();
  unwrap(
    await client.PATCH("/api/recipes/{slug}", {
      params: { path: { slug } },
      body: fields,
    })
  );
}

/**
 * The recipe as Mealie stores it. The cached `Recipe` model drops raw
 * nutrition fields and extras, which the import state and review need.
 * Null for an unknown slug.
 */
export async function getRawRecipe(
  slug: string,
  opts: { client?: MealieClient } = {}
) {
  const client = opts.client ?? mealie();
  const result = await client.GET("/api/recipes/{slug}", {
    params: { path: { slug } },
  });
  if (result.response.status === 404) {
    return null;
  }
  return unwrap(result);
}

const SEARCH_PAGE = 50;
const MAX_SEARCH_PAGES = 10;

type Named = {
  id: string;
  name: string;
  pluralName?: string | null;
  abbreviation?: string | null;
  pluralAbbreviation?: string | null;
};

type Page = { items: Named[]; total_pages?: number };

const normalise = (text: string) => text.trim().toLowerCase();

function pick(items: Named[], wanted: string, fields: (keyof Named)[]) {
  const hit = items.find((item) =>
    fields.some((f) => {
      const value = item[f];
      return typeof value === "string" && normalise(value) === wanted;
    })
  );
  return hit ? { id: hit.id, name: hit.name } : null;
}

/** Looks through the search results page by page; a common word can match many. */
async function searchAll(
  fetchPage: (page: number) => Promise<Page>,
  wanted: string,
  fields: (keyof Named)[]
) {
  let totalPages = 1;
  for (let page = 1; page <= Math.min(totalPages, MAX_SEARCH_PAGES); page++) {
    const result = await fetchPage(page);
    const found = pick(result.items, wanted, fields);
    if (found) {
      return found;
    }
    totalPages = result.total_pages ?? 1;
  }
  return null;
}

/** An existing food with this name (or plural), else a new one. */
export async function findOrCreateFood(
  name: string,
  opts: { client?: MealieClient } = {}
): Promise<{ id: string; name: string }> {
  const client = opts.client ?? mealie();
  const wanted = normalise(name);
  const found = await searchAll(
    async (page) =>
      unwrap(
        await client.GET("/api/foods", {
          params: {
            query: {
              search: wanted,
              orderBy: "name",
              page,
              perPage: SEARCH_PAGE,
            },
          },
        })
      ),
    wanted,
    ["name", "pluralName"]
  );
  if (found) {
    return found;
  }
  const created = unwrap(
    await client.POST("/api/foods", { body: { name: name.trim() } })
  );
  return { id: created.id, name: created.name };
}

/** An existing unit with this name, plural or abbreviation, else a new one. */
export async function findOrCreateUnit(
  name: string,
  opts: { client?: MealieClient } = {}
): Promise<{ id: string; name: string }> {
  const client = opts.client ?? mealie();
  const wanted = normalise(name);
  const found = await searchAll(
    async (page) =>
      unwrap(
        await client.GET("/api/units", {
          params: {
            query: {
              search: wanted,
              orderBy: "name",
              page,
              perPage: SEARCH_PAGE,
            },
          },
        })
      ),
    wanted,
    ["name", "pluralName", "abbreviation", "pluralAbbreviation"]
  );
  if (found) {
    return found;
  }
  const created = unwrap(
    await client.POST("/api/units", { body: { name: name.trim() } })
  );
  return { id: created.id, name: created.name };
}

import { type Organizer, RECIPE_CATEGORIES, RECIPE_TAGS } from "./taxonomy";

/** What the Discover page filters on, as it sits in the URL. */
export type DiscoverState = {
  tags: string[];
  categories: string[];
  quick: boolean;
  page: number;
};

type Params = Record<string, string | string[] | undefined>;

/**
 * The highest `?page=` honoured. A page renders every page up to its own in
 * one Mealie request, so a made-up page number mustn't ask for thousands.
 */
export const MAX_DISCOVER_PAGE = 20;

const all = (value: string | string[] | undefined) =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

/**
 * Reads `?tag=…&category=…&quick=1&page=2`, keeping only slugs Mealie has:
 * it ignores a filter whose slugs it doesn't know, so an unknown one would
 * quietly widen the results instead of narrowing them.
 */
export function parseDiscoverParams(
  params: Params,
  known: { tags: string[]; categories: string[] }
): DiscoverState {
  const pick = (key: string, allowed: string[]) => [
    ...new Set(all(params[key]).filter((s) => allowed.includes(s))),
  ];
  const page = Number(all(params.page)[0]);
  return {
    tags: pick("tag", known.tags),
    categories: pick("category", known.categories),
    quick: all(params.quick)[0] === "1",
    page:
      Number.isInteger(page) && page > 1
        ? Math.min(page, MAX_DISCOVER_PAGE)
        : 1,
  };
}

/** The filters as `tag=…&category=…&quick=1`, as the page and the picker send them. */
export function discoverQuery(
  state: Pick<DiscoverState, "tags" | "categories" | "quick">
): URLSearchParams {
  const query = new URLSearchParams();
  for (const tag of state.tags) {
    query.append("tag", tag);
  }
  for (const category of state.categories) {
    query.append("category", category);
  }
  if (state.quick) {
    query.set("quick", "1");
  }
  return query;
}

/** The page's URL for a state; a filter change always goes back to page 1. */
export function discoverHref(state: DiscoverState): string {
  const query = discoverQuery(state);
  if (state.page > 1) {
    query.set("page", String(state.page));
  }
  const qs = query.toString();
  return qs ? `/recipes?${qs}` : "/recipes";
}

/** What the add-meal picker asks for: Discover's filters plus a name search. */
export type PickerQuery = Omit<DiscoverState, "page"> & {
  search: string;
  page: number;
};

/** The longest name search passed on to Mealie. */
export const MAX_SEARCH_LENGTH = 100;

/**
 * The picker loads page after page as you scroll, with no page in the URL,
 * so it allows more than Discover's `?page=`. Past the cap, the same page
 * would come back for ever.
 */
const MAX_PICKER_PAGE = 1000;

/** The picker's request query string: `q=…&tag=…&page=2`. */
export function pickerSearch(query: PickerQuery): string {
  const params = discoverQuery(query);
  const search = query.search.trim();
  if (search) {
    params.set("q", search);
  }
  if (query.page > 1) {
    params.set("page", String(query.page));
  }
  return params.toString();
}

/** Reads the picker's query string, keeping only slugs Mealie has, as Discover does. */
export function parsePickerSearch(
  params: URLSearchParams,
  known: { tags: string[]; categories: string[] }
): PickerQuery {
  const { tags, categories, quick } = parseDiscoverParams(
    {
      tag: params.getAll("tag"),
      category: params.getAll("category"),
      quick: params.get("quick") ?? undefined,
    },
    known
  );
  const page = Number(params.get("page"));
  return {
    tags,
    categories,
    quick,
    search: (params.get("q") ?? "").trim().slice(0, MAX_SEARCH_LENGTH),
    page:
      Number.isInteger(page) && page > 1 ? Math.min(page, MAX_PICKER_PAGE) : 1,
  };
}

/** The page to load after the first `loaded` pages, or null when that was all. */
export const nextDiscoverPage = (
  loaded: number,
  total: number,
  pageSize: number
): number | null => (loaded * pageSize < total ? loaded + 1 : null);

/**
 * The recipes shown so far followed by the next page's. Pages are fetched
 * minutes apart and a recipe added in between shifts the rest along by one,
 * so the next page can repeat the last one shown: it's kept only once.
 */
export function appendRecipes<T extends { slug: string }>(
  shown: T[],
  more: T[]
): T[] {
  const seen = new Set(shown.map((r) => r.slug));
  return [...shown, ...more.filter((r) => !seen.has(r.slug))];
}

const toggled = (list: string[], slug: string) =>
  list.includes(slug) ? list.filter((s) => s !== slug) : [...list, slug];

export const toggleTag = (
  state: DiscoverState,
  slug: string
): DiscoverState => ({
  ...state,
  tags: toggled(state.tags, slug),
  page: 1,
});

export const toggleCategory = (
  state: DiscoverState,
  slug: string
): DiscoverState => ({
  ...state,
  categories: toggled(state.categories, slug),
  page: 1,
});

export const toggleQuick = (state: DiscoverState): DiscoverState => ({
  ...state,
  quick: !state.quick,
  page: 1,
});

/**
 * Chips in a stable order: the agreed list's order first, then anything
 * else someone added in Mealie, by name. Ones no recipe carries are left
 * out unless selected, so a chip never leads straight to "no recipes".
 */
export function orderChips<T extends Organizer & { recipeCount: number }>(
  organizers: T[],
  agreed: readonly Organizer[],
  selected: string[]
): T[] {
  const rank = (o: T) => {
    const i = agreed.findIndex((a) => a.slug === o.slug);
    return i === -1 ? agreed.length : i;
  };
  return organizers
    .filter((o) => o.recipeCount > 0 || selected.includes(o.slug))
    .toSorted(
      (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "en")
    );
}

export const orderTagChips = <T extends Organizer & { recipeCount: number }>(
  tags: T[],
  selected: string[]
) => orderChips(tags, RECIPE_TAGS, selected);

export const orderCategoryChips = <
  T extends Organizer & { recipeCount: number },
>(
  categories: T[],
  selected: string[]
) => orderChips(categories, RECIPE_CATEGORIES, selected);

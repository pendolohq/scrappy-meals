import { type Organizer, RECIPE_CATEGORIES, RECIPE_TAGS } from "./taxonomy";

/** What the Discover page filters on, as it sits in the URL. */
export type DiscoverState = {
  tags: string[];
  categories: string[];
  quick: boolean;
  page: number;
};

type Params = Record<string, string | string[] | undefined>;

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
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/** The page's URL for a state; a filter change always goes back to page 1. */
export function discoverHref(state: DiscoverState): string {
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
  if (state.page > 1) {
    query.set("page", String(state.page));
  }
  const qs = query.toString();
  return qs ? `/recipes?${qs}` : "/recipes";
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

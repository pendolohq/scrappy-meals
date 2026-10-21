import Link from "next/link";

import { FilterChips } from "@/components/recipe/filter-chips";
import { buttonClass } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import {
  discoverHref,
  orderCategoryChips,
  orderTagChips,
  parseDiscoverParams,
} from "@/server/domain/discover";
import { discoverRecipes, listOrganizers } from "@/server/mealie/recipes";
import { requireUser } from "@/server/session";

import { RecipeGrid } from "./recipe-grid";

/**
 * Browse recipes by Mealie's tags and categories and by total time. The
 * filters live in the URL, so every chip is a plain link and a filtered
 * view can be shared or bookmarked.
 */
export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const organizers = await listOrganizers();
  const state = parseDiscoverParams(await searchParams, {
    tags: organizers.tags.map((t) => t.slug),
    categories: organizers.categories.map((c) => c.slug),
  });
  // `?page=n` (an old link, from before the grid loaded more as you scroll)
  // shows pages 1 to n, so nothing above it is missing.
  const result = await discoverRecipes(state, {
    page: state.page,
    fromStart: true,
  });
  const tags = orderTagChips(organizers.tags, state.tags);
  const categories = orderCategoryChips(
    organizers.categories,
    state.categories
  );
  const href = discoverHref(state);
  const filtered =
    state.tags.length > 0 || state.categories.length > 0 || state.quick;

  return (
    <section className="space-y-6 pb-8">
      <PageHeader
        title="Recipes"
        description="Browse by meal, diet and time, then open one to plan it."
      />

      <div className="space-y-4" data-testid="discover-filters">
        <FilterChips
          state={state}
          tags={tags}
          categories={categories}
          target={(next) => ({ href: discoverHref(next) })}
        />
        {tags.length === 0 && categories.length === 0 && (
          <p className="text-sm text-muted">
            No recipe has tags or categories yet. New imports get them; add them
            to older recipes in Mealie.
          </p>
        )}
      </div>

      <div className="flex min-h-tap items-center justify-between gap-3">
        <p className="text-sm text-muted" aria-live="polite">
          {result.total === 1 ? "1 recipe" : `${result.total} recipes`}
        </p>
        {filtered && (
          <Link
            href="/recipes"
            scroll={false}
            className={buttonClass({ variant: "ghost", size: "sm" })}
          >
            Clear filters
          </Link>
        )}
      </div>

      {result.items.length === 0 ? (
        <p className="rounded-card bg-sunken/70 px-4 py-8 text-center text-muted">
          {filtered
            ? "No recipes match all of these. Try removing a filter."
            : "No recipes in Mealie yet."}
        </p>
      ) : (
        <RecipeGrid
          key={href}
          href={href}
          filters={{
            tags: state.tags,
            categories: state.categories,
            quick: state.quick,
          }}
          initial={{ items: result.items, nextPage: result.nextPage }}
        />
      )}
    </section>
  );
}

import { Check, Clock } from "lucide-react";
import Link from "next/link";

import { buttonClass } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { pillClass } from "@/components/ui/pill";
import { RecipeImage } from "@/components/ui/recipe-image";
import { cx } from "@/lib/cx";
import {
  type DiscoverState,
  discoverHref,
  orderCategoryChips,
  orderTagChips,
  parseDiscoverParams,
  toggleCategory,
  toggleQuick,
  toggleTag,
} from "@/server/domain/discover";
import { formatMinutes, QUICK_MAX_MINUTES } from "@/server/domain/taxonomy";
import { discoverRecipes, listOrganizers } from "@/server/mealie/recipes";
import { requireUser } from "@/server/session";

const Chip = ({
  href,
  selected,
  children,
}: {
  href: string;
  selected: boolean;
  children: React.ReactNode;
}) => (
  <li className="-my-1.5 flex min-h-tap items-center">
    <Link
      href={href}
      scroll={false}
      aria-current={selected || undefined}
      className={cx(
        pillClass(selected ? "solid" : "neutral"),
        "py-1.5 text-sm",
        !selected && "hover:text-foreground"
      )}
    >
      {selected && <Check className="size-3.5" aria-hidden />}
      {children}
    </Link>
  </li>
);

const ChipRow = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <div className="space-y-1.5">
    <h2 className="text-xs font-semibold tracking-wider text-muted uppercase">
      {label}
    </h2>
    <ul className="flex flex-wrap gap-x-2 gap-y-1" aria-label={label}>
      {children}
    </ul>
  </div>
);

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
  let result = await discoverRecipes(state, { page: state.page });
  if (state.page > result.totalPages && result.total > 0) {
    // A page past the end (an old link after recipes were removed): show
    // the last one.
    state.page = result.totalPages;
    result = await discoverRecipes(state, { page: state.page });
  }
  const tags = orderTagChips(organizers.tags, state.tags);
  const categories = orderCategoryChips(
    organizers.categories,
    state.categories
  );
  const filtered =
    state.tags.length > 0 || state.categories.length > 0 || state.quick;
  const page = (n: number): DiscoverState => ({ ...state, page: n });

  return (
    <section className="space-y-6 pb-8">
      <PageHeader
        title="Recipes"
        description="Browse by meal, diet and time, then open one to plan it."
      />

      <div className="space-y-4" data-testid="discover-filters">
        <ChipRow label="Tags">
          <Chip href={discoverHref(toggleQuick(state))} selected={state.quick}>
            <Clock className="size-3.5" aria-hidden />
            Quick ({QUICK_MAX_MINUTES} min or less)
          </Chip>
          {tags.map((t) => (
            <Chip
              key={t.slug}
              href={discoverHref(toggleTag(state, t.slug))}
              selected={state.tags.includes(t.slug)}
            >
              {t.name}
            </Chip>
          ))}
        </ChipRow>
        {categories.length > 0 && (
          <ChipRow label="Categories">
            {categories.map((c) => (
              <Chip
                key={c.slug}
                href={discoverHref(toggleCategory(state, c.slug))}
                selected={state.categories.includes(c.slug)}
              >
                {c.name}
              </Chip>
            ))}
          </ChipRow>
        )}
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
        <ul
          className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3"
          data-testid="discover-results"
        >
          {result.items.map((r) => (
            <li key={r.slug}>
              <Link
                href={`/recipes/${r.slug}`}
                className="group block space-y-2 rounded-card"
              >
                <RecipeImage
                  mealieId={r.imagePath && r.id ? r.id : null}
                  className="aspect-[4/3] w-full transition group-hover:brightness-95"
                  rounded="rounded-card"
                />
                <span className="line-clamp-2 font-serif font-semibold group-hover:underline">
                  {r.name}
                </span>
                {r.totalMinutes && (
                  <span className="flex items-center gap-1 text-xs text-muted">
                    <Clock className="size-3" aria-hidden />
                    {formatMinutes(r.totalMinutes)}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {result.totalPages > 1 && (
        <nav
          aria-label="Pages"
          className="flex items-center justify-between gap-3"
        >
          {state.page > 1 ? (
            <Link
              href={discoverHref(page(state.page - 1))}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm text-muted">
            Page {state.page} of {result.totalPages}
          </span>
          {state.page < result.totalPages ? (
            <Link
              href={discoverHref(page(state.page + 1))}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </section>
  );
}

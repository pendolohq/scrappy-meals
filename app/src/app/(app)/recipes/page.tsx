import { Check, Clock } from "lucide-react";
import Link from "next/link";

import { buttonClass } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { pillClass } from "@/components/ui/pill";
import { cx } from "@/lib/cx";
import {
  discoverHref,
  orderCategoryChips,
  orderTagChips,
  parseDiscoverParams,
  toggleCategory,
  toggleQuick,
  toggleTag,
} from "@/server/domain/discover";
import { QUICK_MAX_MINUTES } from "@/server/domain/taxonomy";
import { discoverRecipes, listOrganizers } from "@/server/mealie/recipes";
import { requireUser } from "@/server/session";

import { RecipeGrid } from "./recipe-grid";

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

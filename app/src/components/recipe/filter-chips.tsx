import { Check, Clock } from "lucide-react";
import Link from "next/link";

import { pillClass } from "@/components/ui/pill";
import { cx } from "@/lib/cx";
import {
  type DiscoverState,
  toggleCategory,
  toggleQuick,
  toggleTag,
} from "@/server/domain/discover";
import { QUICK_MAX_MINUTES } from "@/server/domain/taxonomy";
import type { OrganizerCount } from "@/server/mealie/recipes";

/** Where a chip goes: a link on Discover, where the filters live in the URL; a button in the picker. */
type ChipTarget = { href: string } | { onClick: () => void };

const Chip = ({
  target,
  selected,
  children,
}: {
  target: ChipTarget;
  selected: boolean;
  children: React.ReactNode;
}) => {
  const className = cx(
    pillClass(selected ? "solid" : "neutral"),
    "py-1.5 text-sm",
    !selected && "hover:text-foreground"
  );
  const content = (
    <>
      {selected && <Check className="size-3.5" aria-hidden />}
      {children}
    </>
  );
  return (
    <li className="-my-1.5 flex min-h-tap items-center">
      {"href" in target ? (
        <Link
          href={target.href}
          scroll={false}
          aria-current={selected || undefined}
          className={className}
        >
          {content}
        </Link>
      ) : (
        <button
          type="button"
          onClick={target.onClick}
          aria-pressed={selected}
          className={className}
        >
          {content}
        </button>
      )}
    </li>
  );
};

const ChipRow = ({
  label,
  compact,
  children,
}: {
  label: string;
  compact: boolean;
  children: React.ReactNode;
}) => (
  <div className={compact ? undefined : "space-y-1.5"}>
    <h2
      className={
        compact
          ? "sr-only"
          : "text-xs font-semibold tracking-wider text-muted uppercase"
      }
    >
      {label}
    </h2>
    <ul
      className={cx(
        "flex gap-x-2",
        compact
          ? // The padding holds the chips' tap-height overhang, which would otherwise scroll.
            "-mx-4 -my-1.5 overflow-x-auto overscroll-x-contain px-4 py-1.5 [scrollbar-width:none]"
          : "flex-wrap gap-y-1"
      )}
      aria-label={label}
    >
      {children}
    </ul>
  </div>
);

/**
 * Discover's filters: Quick and the tags in one row, the categories in
 * another. `tags` and `categories` come ordered (`orderTagChips`, …);
 * `target` says what picking the state a chip toggles to does. `compact`
 * puts each row on one line that scrolls sideways, for a header that has
 * to stay short.
 */
export const FilterChips = ({
  state,
  tags,
  categories,
  target,
  compact = false,
}: {
  state: DiscoverState;
  tags: OrganizerCount[];
  categories: OrganizerCount[];
  target: (next: DiscoverState) => ChipTarget;
  compact?: boolean;
}) => (
  <>
    <ChipRow label="Tags" compact={compact}>
      <Chip target={target(toggleQuick(state))} selected={state.quick}>
        <Clock className="size-3.5" aria-hidden />
        Quick ({QUICK_MAX_MINUTES} min or less)
      </Chip>
      {tags.map((t) => (
        <Chip
          key={t.slug}
          target={target(toggleTag(state, t.slug))}
          selected={state.tags.includes(t.slug)}
        >
          {t.name}
        </Chip>
      ))}
    </ChipRow>
    {categories.length > 0 && (
      <ChipRow label="Categories" compact={compact}>
        {categories.map((c) => (
          <Chip
            key={c.slug}
            target={target(toggleCategory(state, c.slug))}
            selected={state.categories.includes(c.slug)}
          >
            {c.name}
          </Chip>
        ))}
      </ChipRow>
    )}
  </>
);

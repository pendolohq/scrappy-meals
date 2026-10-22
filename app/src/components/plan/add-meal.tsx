"use client";

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useTransition,
} from "react";
import { Clock, Plus, Search, X } from "lucide-react";

import { addMealAction, loadProductAction } from "@/app/(app)/week/actions";
import { FilterChips } from "@/components/recipe/filter-chips";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { inputClass } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { RecipeImage } from "@/components/ui/recipe-image";
import { cx } from "@/lib/cx";
import { formatDay } from "@/lib/format";
import {
  appendRecipes,
  type DiscoverState,
  MAX_SEARCH_LENGTH,
  pickerSearch,
} from "@/server/domain/discover";
import type { SlotType } from "@/server/domain/slots";
import { formatMinutes, tagForSlot } from "@/server/domain/taxonomy";
import type { OrganizerCount, RecipeListItem } from "@/server/mealie/recipes";
import type { ProductLookup } from "@/server/products";

import { attempt, failureText } from "./attempt";
import { ProductTab } from "./product/product-tab";
import { searchRecipes } from "./use-recipe-list";

type Page = {
  items: RecipeListItem[];
  total: number;
  nextPage: number | null;
  tags: OrganizerCount[];
  categories: OrganizerCount[];
};

type Results = Page & {
  status: "idle" | "loading" | "done" | "error";
  /** Loading the next page, separately from a new search. */
  more: "idle" | "loading" | "failed";
  error?: string;
};

const EMPTY: Results = {
  status: "idle",
  more: "idle",
  items: [],
  total: 0,
  nextPage: null,
  tags: [],
  categories: [],
};

const fetchPage = (
  query: Parameters<typeof pickerSearch>[0],
  signal: AbortSignal
) => searchRecipes<Page>(pickerSearch(query), signal);

/**
 * The picker's results for a search and filters, a page at a time. A new
 * search or filter starts again from the first page and abandons whatever
 * was loading; the chips stay up from the last answer meanwhile.
 */
const usePickerResults = (
  search: string,
  filters: DiscoverState,
  enabled: boolean
) => {
  const [results, setResults] = useState<Results>(EMPTY);
  const ctrl = useRef<AbortController>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const mine = new AbortController();
    ctrl.current?.abort();
    ctrl.current = mine;
    const timer = setTimeout(async () => {
      setResults((r) => ({ ...r, status: "loading" }));
      try {
        const page = await fetchPage(
          { ...filters, search, page: 1 },
          mine.signal
        );
        setResults({ ...page, status: "done", more: "idle" });
      } catch (err) {
        if (!mine.signal.aborted) {
          setResults((r) => ({
            ...EMPTY,
            tags: r.tags,
            categories: r.categories,
            status: "error",
            error: (err as Error).message,
          }));
        }
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      mine.abort();
    };
  }, [search, filters, enabled]);

  const loadMore = async () => {
    const { nextPage, status, more } = results;
    if (nextPage === null || status !== "done" || more === "loading") {
      return;
    }
    const signal = ctrl.current?.signal;
    if (!signal || signal.aborted) {
      return;
    }
    setResults((r) => ({ ...r, more: "loading" }));
    try {
      const page = await fetchPage(
        { ...filters, search, page: nextPage },
        signal
      );
      setResults((r) => ({
        ...r,
        items: appendRecipes(r.items, page.items),
        nextPage: page.nextPage,
        more: "idle",
      }));
    } catch {
      if (!signal.aborted) {
        setResults((r) => ({ ...r, more: "failed" }));
      }
    }
  };

  return { results, loadMore };
};

/** Only the results scroll while the picker is open; iOS would otherwise scroll the page behind it. */
const useScrollLock = (locked: boolean) => {
  useEffect(() => {
    if (!locked) {
      return;
    }
    const html = document.documentElement;
    const before = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = before;
    };
  }, [locked]);
};

const RecipeOption = ({
  recipe,
  disabled,
  onPick,
}: {
  recipe: RecipeListItem;
  disabled: boolean;
  onPick: () => void;
}) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onPick}
    className="flex w-full items-center gap-3 rounded-button p-2 text-left transition hover:bg-sunken disabled:opacity-60"
  >
    <RecipeImage
      mealieId={recipe.imagePath && recipe.id ? recipe.id : null}
      className="size-14"
    />
    <span className="min-w-0 flex-1 space-y-1">
      <span className="line-clamp-2 font-serif font-semibold">
        {recipe.name}
      </span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        {recipe.isProduct ? (
          <Pill tone="accent">Product</Pill>
        ) : recipe.servings ? (
          <span>{recipe.servings} servings</span>
        ) : (
          <Pill tone="danger">⚠ No servings count</Pill>
        )}
        {recipe.totalMinutes && (
          <span className="flex items-center gap-1">
            <Clock className="size-3" aria-hidden />
            {formatMinutes(recipe.totalMinutes)}
          </span>
        )}
      </span>
    </span>
  </button>
);

export const AddMeal = ({
  date,
  slot,
  snackIndex,
  label,
  today,
  className,
  text,
}: {
  date: string;
  slot: SlotType;
  snackIndex: number;
  label: string;
  /** The viewer's today: a product can only have been eaten up to then. */
  today: string;
  /** Replaces the trigger's styling. */
  className?: string;
  /** Shorter trigger text where the slot is clear from around it; screen readers still hear the slot and day. */
  text?: string;
}) => {
  // Starts on the slot's meal tag, as "Add to meal plan" starts on the slot
  // the tags name; one tap on the chip clears it. A tag Mealie doesn't have
  // gets no chip and is dropped by the search.
  const startFilters = (): DiscoverState => ({
    tags: [tagForSlot(slot)],
    categories: [],
    quick: false,
    page: 1,
  });
  const slotTag = tagForSlot(slot);
  const dialog = useRef<HTMLDialogElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"recipes" | "product">("recipes");
  // A product picked from the results: its sheet opens in the Product tab.
  const [picked, setPicked] = useState<ProductLookup>();
  // The slot's meal tag lifted by typing a search; see `onSearch`.
  const liftedTag = useRef(false);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(startFilters);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const { results, loadMore } = usePickerResults(
    query,
    filters,
    open && mode === "recipes"
  );
  useScrollLock(open);
  const future = date > today;

  const show = () => {
    setOpen(true);
    setError(undefined);
    dialog.current?.showModal();
  };
  const close = () => dialog.current?.close();
  // Escape closes the dialog without going through `close`.
  const onClose = () => {
    setOpen(false);
    setQuery("");
    setFilters(startFilters());
    setMode("recipes");
    setPicked(undefined);
    liftedTag.current = false;
  };

  // Products aren't tagged with meals, so the slot's tag would hide them from
  // a search by name. Typing the first characters lifts it; emptying the
  // search puts it back, unless the chips were touched in between.
  const onSearch = (value: string) => {
    const was = query.trim() !== "";
    const now = value.trim() !== "";
    setQuery(value);
    if (
      now &&
      !was &&
      filters.tags.length === 1 &&
      filters.tags[0] === slotTag
    ) {
      liftedTag.current = true;
      setFilters({ ...filters, tags: [] });
    } else if (!now && was && liftedTag.current) {
      liftedTag.current = false;
      if (filters.tags.length === 0) {
        setFilters({ ...filters, tags: [slotTag] });
      }
    }
  };

  const filter = (next: DiscoverState) => {
    liftedTag.current = false;
    setFilters(next);
    scroller.current?.scrollTo({ top: 0 });
  };

  const pick = ({ slug, isProduct }: RecipeListItem) =>
    startTransition(async () => {
      setError(undefined);
      if (isProduct) {
        // Portion and "Already had it?" are chosen on the product's sheet.
        const res = await attempt(() => loadProductAction({ slug }));
        if (res.error === undefined) {
          setPicked(res);
          setMode("product");
        } else {
          setError(failureText(res));
          scroller.current?.scrollTo({ top: 0 });
        }
        return;
      }
      const res = await attempt(() =>
        addMealAction({ date, slot, snackIndex, slug })
      );
      if (res.error) {
        setError(failureText(res));
        scroller.current?.scrollTo({ top: 0 });
      } else {
        close();
      }
    });

  const { status, nextPage, more } = results;
  const onSentinelInView = useEffectEvent(() => void loadMore());
  useEffect(() => {
    // After a failure only the button retries, so offline doesn't loop.
    const target = sentinel.current;
    if (
      !open ||
      !target ||
      status !== "done" ||
      nextPage === null ||
      more !== "idle"
    ) {
      return;
    }
    // A new observer per page, as on Discover: a new one reports at once if
    // the end of the list is still showing, so short pages keep filling.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          onSentinelInView();
        }
      },
      // The list scrolls, not the page: the sentinel sits at its end.
      { root: target.parentElement, rootMargin: "0px 0px 600px 0px" }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [open, status, nextPage, more]);

  const what = label.toLowerCase();

  return (
    <>
      <button
        type="button"
        onClick={show}
        aria-label={text ? `Add ${what}, ${formatDay(date)}` : undefined}
        className={
          className ??
          "-mr-2 inline-flex min-h-tap items-center gap-1 rounded-button px-3 text-sm font-medium text-accent-ink transition hover:bg-accent-soft"
        }
      >
        <Plus className="size-4" aria-hidden />
        {text ?? `Add ${what}`}
      </button>
      {/* The whole screen on phones, a centred dialog on wider screens. */}
      <dialog
        ref={dialog}
        onClose={onClose}
        className={cx(
          "fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none border-0 bg-card p-0 text-foreground backdrop:bg-scrim/40 backdrop:backdrop-blur-[2px]",
          "sm:m-auto sm:h-[min(48rem,85dvh)] sm:w-[min(36rem,calc(100vw-2rem))] sm:rounded-card sm:border sm:border-border sm:shadow-raised"
        )}
        aria-label={`Add ${what}`}
      >
        <div className="flex h-full flex-col">
          <div className="shrink-0 space-y-3 border-b border-border px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-3 sm:pt-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-serif text-heading font-semibold">
                Add {what}{" "}
                <span className="font-sans text-sm font-normal text-muted">
                  · {formatDay(date)}
                </span>
              </h2>
              <IconButton label="Close" className="-mr-2" onClick={close}>
                <X className="size-5" aria-hidden />
              </IconButton>
            </div>
            <div
              role="tablist"
              aria-label="What to add"
              className="grid grid-cols-2 gap-1 rounded-button bg-sunken p-1"
            >
              {(
                [
                  ["recipes", "Recipes"],
                  ["product", "Product"],
                ] as const
              ).map(([id, title]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={mode === id}
                  onClick={() => {
                    setPicked(undefined);
                    setMode(id);
                  }}
                  className={cx(
                    "min-h-tap rounded-[3px] text-sm font-medium transition",
                    mode === id
                      ? "bg-card text-foreground shadow-card"
                      : "text-muted hover:text-foreground"
                  )}
                >
                  {title}
                </button>
              ))}
            </div>
            {mode === "recipes" && (
              <div className="relative">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted"
                  aria-hidden
                />
                <input
                  type="search"
                  autoFocus
                  value={query}
                  maxLength={MAX_SEARCH_LENGTH}
                  onChange={(e) => onSearch(e.target.value)}
                  placeholder="Search recipes in Mealie"
                  aria-label="Search recipes"
                  className={cx(inputClass, "bg-background pl-10")}
                />
              </div>
            )}
            {open && mode === "recipes" && (
              <div className="space-y-2" data-testid="picker-filters">
                <FilterChips
                  compact
                  state={filters}
                  tags={results.tags}
                  categories={results.categories}
                  target={(next) => ({ onClick: () => filter(next) })}
                />
              </div>
            )}
          </div>
          {open && mode === "product" && (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(0.5rem,env(safe-area-inset-bottom))]">
              <ProductTab
                at={{ date, slot, snackIndex }}
                future={future}
                onAdded={close}
                initial={picked}
              />
            </div>
          )}
          {open && mode === "recipes" && (
            <div
              ref={scroller}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
            >
              <div aria-live="polite">
                {results.status === "loading" && results.items.length === 0 && (
                  <p className="p-3 text-sm text-muted">Searching…</p>
                )}
                {results.status === "error" && (
                  <p className="p-3 text-sm text-danger">{results.error}</p>
                )}
                {results.status === "done" && (
                  <p className="px-3 pt-1 pb-2 text-sm text-muted">
                    {results.total === 0
                      ? "No recipes found."
                      : results.total === 1
                        ? "1 recipe"
                        : `${results.total} recipes`}
                  </p>
                )}
              </div>
              {error && (
                <p role="alert" className="p-3 text-sm text-danger">
                  {error}
                </p>
              )}
              <ul className={cx(results.status === "loading" && "opacity-60")}>
                {results.items.map((r) => (
                  <li key={r.slug}>
                    <RecipeOption
                      recipe={r}
                      disabled={pending}
                      onPick={() => pick(r)}
                    />
                  </li>
                ))}
              </ul>
              {results.status === "done" && nextPage !== null && (
                <div
                  ref={sentinel}
                  className="flex flex-col items-center gap-2 py-3"
                >
                  {more === "failed" && (
                    <p role="alert" className="text-sm text-muted">
                      Couldn&rsquo;t load more.
                    </p>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void loadMore()}
                    disabled={more === "loading"}
                  >
                    {more === "loading"
                      ? "Loading…"
                      : more === "failed"
                        ? "Try again"
                        : "Load more"}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </dialog>
    </>
  );
};

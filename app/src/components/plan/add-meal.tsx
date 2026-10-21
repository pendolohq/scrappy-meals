"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Plus, Search, X } from "lucide-react";

import { addMealAction, loadProductAction } from "@/app/(app)/week/actions";
import { IconButton } from "@/components/ui/icon-button";
import { inputClass } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { RecipeImage } from "@/components/ui/recipe-image";
import { cx } from "@/lib/cx";
import { formatDay } from "@/lib/format";
import type { SlotType } from "@/server/domain/slots";
import type { ProductLookup } from "@/server/products";

import { attempt, failureText } from "./attempt";
import { ProductTab } from "./product-tab";
import { useRecipeList } from "./use-recipe-list";

export const AddMeal = ({
  date,
  slot,
  snackIndex,
  label,
  today,
  className,
  text,
  initialMode = "recipes",
  controlled,
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
  /** The tab the dialog opens on. */
  initialMode?: "recipes" | "product";
  /** Opened from elsewhere (no trigger button of its own): the parent owns `open`. */
  controlled?: { open: boolean; onClose: () => void };
}) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(initialMode);
  // A product picked from the search: its sheet opens in the Product tab.
  const [picked, setPicked] = useState<ProductLookup>();
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const searching = open && mode === "recipes";
  const search = useRecipeList(
    `/api/recipes/search?q=${encodeURIComponent(query)}`,
    searching,
    250
  );
  const future = date > today;

  const show = () => {
    setOpen(true);
    setMode(initialMode);
    setError(undefined);
    dialog.current?.showModal();
  };
  const close = () => {
    dialog.current?.close();
    setOpen(false);
    setQuery("");
    setMode(initialMode);
    setPicked(undefined);
  };

  const wantsOpen = controlled?.open ?? false;
  useEffect(() => {
    if (wantsOpen && !dialog.current?.open) {
      show();
    }
    // `show` only reads props that stay put while the dialog is open.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsOpen]);

  const pick = (slug: string, isProduct: boolean) =>
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
        }
        return;
      }
      const res = await attempt(() =>
        // Logging what someone had instead is eaten off-plan, by them alone.
        addMealAction({
          date,
          slot,
          snackIndex,
          slug,
          ...(controlled ? { alreadyHad: true } : {}),
        })
      );
      if (res.error) {
        setError(failureText(res));
      } else {
        close();
      }
    });

  const what = label.toLowerCase();

  return (
    <>
      {!controlled && (
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
      )}
      {/* A bottom sheet on phones, a centred dialog on wider screens. */}
      <dialog
        ref={dialog}
        onClose={() => {
          // Esc and the backdrop close it natively too: nothing stale may
          // greet the next opening.
          setOpen(false);
          setQuery("");
          setMode(initialMode);
          setPicked(undefined);
          controlled?.onClose();
        }}
        className={cx(
          "mx-auto mt-auto mb-0 w-full max-w-none rounded-t-card border border-border bg-card p-0 text-foreground shadow-raised backdrop:bg-scrim/40 backdrop:backdrop-blur-[2px]",
          "sm:m-auto sm:w-[min(32rem,calc(100vw-2rem))] sm:rounded-card"
        )}
        aria-label={`Add ${what}`}
      >
        <div className="flex max-h-[85dvh] flex-col pb-[env(safe-area-inset-bottom)] sm:max-h-[80dvh] sm:pb-0">
          <div className="space-y-3 border-b border-border p-4">
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
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search recipes in Mealie"
                  aria-label="Search recipes"
                  className={cx(inputClass, "bg-background pl-10")}
                />
              </div>
            )}
          </div>
          {open && mode === "product" && (
            <div className="overflow-y-auto">
              <ProductTab
                at={{ date, slot, snackIndex }}
                future={future}
                onAdded={close}
                initial={picked}
              />
            </div>
          )}
          {searching && (
            <div className="overflow-y-auto p-2" aria-live="polite">
              {search.status === "loading" && search.items.length === 0 && (
                <p className="p-3 text-sm text-muted">Searching…</p>
              )}
              {search.status === "error" && (
                <p className="p-3 text-sm text-danger">{search.error}</p>
              )}
              {search.status === "done" && search.items.length === 0 && (
                <p className="p-3 text-sm text-muted">No recipes found.</p>
              )}
              {error && (
                <p role="alert" className="p-3 text-sm text-danger">
                  {error}
                </p>
              )}
              <ul>
                {search.items.map((r) => (
                  <li key={r.slug}>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => pick(r.slug, r.isProduct)}
                      className="flex w-full items-center gap-3 rounded-button p-2 text-left transition hover:bg-sunken disabled:opacity-60"
                    >
                      <RecipeImage
                        mealieId={r.imagePath && r.id ? r.id : null}
                        className="size-14"
                      />
                      <span className="min-w-0 flex-1 space-y-1">
                        <span className="line-clamp-2 font-serif font-semibold">
                          {r.name}
                        </span>
                        {r.isProduct ? (
                          <Pill tone="accent">Product</Pill>
                        ) : r.servings ? (
                          <span className="block text-xs text-muted">
                            {r.servings} servings
                          </span>
                        ) : (
                          <Pill tone="danger">⚠ No servings count</Pill>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </dialog>
    </>
  );
};

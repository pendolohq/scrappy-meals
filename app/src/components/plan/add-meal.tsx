"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Plus, Search, X } from "lucide-react";

import { addMealAction } from "@/app/(app)/week/actions";
import { IconButton } from "@/components/ui/icon-button";
import { inputClass } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { RecipeImage } from "@/components/ui/recipe-image";
import { cx } from "@/lib/cx";
import { formatDay } from "@/lib/format";
import type { SlotType } from "@/server/domain/slots";
import type { RecipeListItem } from "@/server/mealie/recipes";

type SearchState = {
  status: "idle" | "loading" | "done" | "error";
  items: RecipeListItem[];
  error?: string;
};

const useRecipeSearch = (query: string, enabled: boolean): SearchState => {
  const [state, setState] = useState<SearchState>({
    status: "idle",
    items: [],
  });
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setState((s) => ({ ...s, status: "loading" }));
      try {
        const res = await fetch(
          `/api/recipes/search?q=${encodeURIComponent(query)}`,
          { signal: ctrl.signal }
        );
        const body = await res.json();
        if (!res.ok) {
          throw new Error(body.error ?? "Search failed");
        }
        setState({ status: "done", items: body.items });
      } catch (err) {
        if (!ctrl.signal.aborted) {
          setState({
            status: "error",
            items: [],
            error: (err as Error).message,
          });
        }
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query, enabled]);
  return state;
};

export const AddMeal = ({
  date,
  slot,
  snackIndex,
  label,
  className,
}: {
  date: string;
  slot: SlotType;
  snackIndex: number;
  label: string;
  /** Replaces the trigger's styling; its text stays "Add <slot>". */
  className?: string;
}) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const search = useRecipeSearch(query, open);

  const show = () => {
    setOpen(true);
    setError(undefined);
    dialog.current?.showModal();
  };
  const close = () => {
    dialog.current?.close();
    setOpen(false);
    setQuery("");
  };

  const pick = (slug: string) =>
    startTransition(async () => {
      const res = await addMealAction({ date, slot, snackIndex, slug });
      if (res.error) {
        setError(res.error);
      } else {
        close();
      }
    });

  const what = label.toLowerCase();

  return (
    <>
      <button
        type="button"
        onClick={show}
        className={
          className ??
          "-mr-2 inline-flex min-h-tap items-center gap-1 rounded-button px-3 text-sm font-medium text-accent-ink transition hover:bg-accent-soft"
        }
      >
        <Plus className="size-4" aria-hidden />
        Add {what}
      </button>
      {/* A bottom sheet on phones, a centred dialog on wider screens. */}
      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
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
          </div>
          {open && (
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
                      onClick={() => pick(r.slug)}
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
                        {r.servings ? (
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

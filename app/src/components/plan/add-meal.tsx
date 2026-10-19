"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { addMealAction } from "@/app/(app)/week/actions";
import type { RecipeListItem } from "@/server/mealie/recipes";
import type { SlotType } from "@/server/plan";

type SearchState = {
  status: "idle" | "loading" | "done" | "error";
  items: RecipeListItem[];
  error?: string;
};

function useRecipeSearch(query: string, enabled: boolean): SearchState {
  const [state, setState] = useState<SearchState>({
    status: "idle",
    items: [],
  });
  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setState((s) => ({ ...s, status: "loading" }));
      try {
        const res = await fetch(
          `/api/recipes/search?q=${encodeURIComponent(query)}`,
          { signal: ctrl.signal },
        );
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Search failed");
        setState({ status: "done", items: body.items });
      } catch (err) {
        if (!ctrl.signal.aborted)
          setState({
            status: "error",
            items: [],
            error: (err as Error).message,
          });
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query, enabled]);
  return state;
}

export function AddMeal({
  date,
  slot,
  label,
}: {
  date: string;
  slot: SlotType;
  label: string;
}) {
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
      const res = await addMealAction({ date, slot, slug });
      if (res.error) setError(res.error);
      else close();
    });

  return (
    <>
      <button
        type="button"
        onClick={show}
        className="text-sm font-medium text-accent"
      >
        + Add {label.toLowerCase()}
      </button>
      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-border bg-card p-0 text-foreground backdrop:bg-black/40"
        aria-label={`Add ${label.toLowerCase()}`}
      >
        <div className="flex max-h-[80dvh] flex-col">
          <div className="flex items-center gap-2 border-b border-border p-3">
            <input
              type="search"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search recipes in Mealie"
              aria-label="Search recipes"
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2"
            />
            <button type="button" onClick={close} className="px-2 text-muted">
              Cancel
            </button>
          </div>
          {open && (
            <div className="overflow-y-auto p-2" aria-live="polite">
              {search.status === "loading" && search.items.length === 0 && (
                <p className="p-2 text-sm text-muted">Searching…</p>
              )}
              {search.status === "error" && (
                <p className="p-2 text-sm text-danger">{search.error}</p>
              )}
              {search.status === "done" && search.items.length === 0 && (
                <p className="p-2 text-sm text-muted">No recipes found.</p>
              )}
              {error && (
                <p role="alert" className="p-2 text-sm text-danger">
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
                      className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-background disabled:opacity-60"
                    >
                      {r.imagePath && r.id ? (
                        // oxlint-disable-next-line nextjs/no-img-element -- proxied Mealie thumbnails
                        <img
                          src={`/api/recipe-images/${r.id}`}
                          alt=""
                          className="h-10 w-10 rounded-md object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <span
                          className="h-10 w-10 rounded-md bg-border"
                          aria-hidden
                        />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {r.name}
                        </span>
                        {r.servings ? (
                          <span className="text-xs text-muted">
                            {r.servings} servings
                          </span>
                        ) : (
                          <span className="text-xs text-danger">
                            ⚠ No servings count
                          </span>
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
}

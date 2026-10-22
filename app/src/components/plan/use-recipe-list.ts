"use client";

import { useEffect, useState } from "react";

import type { RecipeListItem } from "@/server/mealie/recipes";

/** A page from the recipe search route, or its message when it refuses. */
export const searchRecipes = async <T extends { items: RecipeListItem[] }>(
  query: string,
  signal: AbortSignal
): Promise<T> => {
  const res = await fetch(`/api/recipes/search?${query}`, { signal });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? "Search failed");
  }
  return body;
};

export type RecipeListState = {
  status: "idle" | "done" | "error";
  items: RecipeListItem[];
  error?: string;
};

/** One page of the recipe search for `query`, fetched while `enabled`. */
export const useRecipeList = (
  query: string,
  enabled: boolean
): RecipeListState => {
  const [state, setState] = useState<RecipeListState>({
    status: "idle",
    items: [],
  });
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const ctrl = new AbortController();
    searchRecipes(query, ctrl.signal).then(
      ({ items }) => setState({ status: "done", items }),
      (err: Error) => {
        if (!ctrl.signal.aborted) {
          setState({ status: "error", items: [], error: err.message });
        }
      }
    );
    return () => ctrl.abort();
  }, [query, enabled]);
  return state;
};

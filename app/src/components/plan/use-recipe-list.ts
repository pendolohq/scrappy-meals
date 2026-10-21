"use client";

import { useEffect, useState } from "react";

import type { RecipeListItem } from "@/server/mealie/recipes";

export type RecipeListState = {
  status: "idle" | "loading" | "done" | "error";
  items: RecipeListItem[];
  error?: string;
};

/** Fetches `{ items }` from the recipe search route, after `delayMs` (typing). */
export const useRecipeList = (
  url: string,
  enabled: boolean,
  delayMs = 0
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
    const timer = setTimeout(async () => {
      setState((s) => ({ ...s, status: "loading" }));
      try {
        const res = await fetch(url, { signal: ctrl.signal });
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
    }, delayMs);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [url, enabled, delayMs]);
  return state;
};

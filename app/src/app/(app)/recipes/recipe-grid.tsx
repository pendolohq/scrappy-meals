"use client";

import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Clock } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { RecipeImage } from "@/components/ui/recipe-image";
import { appendRecipes } from "@/server/domain/discover";
import { formatMinutes } from "@/server/domain/taxonomy";
import type { DiscoverFilters, RecipeListItem } from "@/server/mealie/recipes";

import { loadMoreRecipesAction } from "./actions";

type Loaded = { items: RecipeListItem[]; nextPage: number | null };
type Saved = Loaded & { scrollY: number };

const STORAGE_KEY = "discover-grid";

// The router remounts the grid on Back, dropping the pages loaded by
// scrolling. They're saved when a recipe is opened and put back only when
// the page comes back through history, not when it's opened afresh.
let poppedAt = 0;
if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    poppedAt = Date.now();
  });
}

const takeSaved = (href: string): Saved | null => {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    return saved?.href === href && Date.now() - poppedAt < 2000 ? saved : null;
  } catch {
    return null;
  }
};

const save = (href: string, saved: Saved) => {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ href, ...saved }));
  } catch {
    // Private mode or full: coming back starts at the top, which is fine.
  }
};

const RecipeCard = ({ recipe }: { recipe: RecipeListItem }) => (
  <Link
    href={`/recipes/${recipe.slug}`}
    className="group block space-y-2 rounded-card"
  >
    <RecipeImage
      mealieId={recipe.imagePath && recipe.id ? recipe.id : null}
      className="aspect-[4/3] w-full transition group-hover:brightness-95"
      rounded="rounded-card"
    />
    <span className="line-clamp-2 font-serif font-semibold group-hover:underline">
      {recipe.name}
    </span>
    {recipe.totalMinutes && (
      <span className="flex items-center gap-1 text-xs text-muted">
        <Clock className="size-3" aria-hidden />
        {formatMinutes(recipe.totalMinutes)}
      </span>
    )}
  </Link>
);

/**
 * The Discover results. The server renders the first page (or pages, for
 * `?page=n`); the rest load as the end of the grid scrolls into view, or
 * with "Load more" for keyboards, screen readers and when the observer
 * doesn't fire. `href` is the page's URL: a new one remounts the grid.
 */
export const RecipeGrid = ({
  href,
  filters,
  initial,
}: {
  href: string;
  filters: DiscoverFilters;
  initial: Loaded;
}) => {
  const [loaded, setLoaded] = useState(initial);
  const [status, setStatus] = useState<"idle" | "loading" | "failed">("idle");
  const busy = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);

  // Once per mount: the page keys the grid by its URL.
  const restore = useEffectEvent(() => {
    const saved = takeSaved(href);
    if (saved) {
      setLoaded({
        items: appendRecipes(initial.items, saved.items),
        nextPage: saved.nextPage,
      });
      // Once those pages are in the DOM.
      requestAnimationFrame(() => window.scrollTo(0, saved.scrollY));
    }
  });
  // oxlint-disable-next-line react/set-state-in-effect -- sessionStorage exists only in the browser, so it can't seed the server-rendered state
  useLayoutEffect(() => restore(), []);

  const { nextPage } = loaded;
  const loadMore = async () => {
    if (busy.current || nextPage === null) {
      return;
    }
    busy.current = true;
    setStatus("loading");
    const result = await loadMoreRecipesAction({
      ...filters,
      page: nextPage,
    }).catch(() => null);
    busy.current = false;
    if (!result || result.error !== undefined) {
      setStatus("failed");
      return;
    }
    setLoaded((prev) => ({
      items: appendRecipes(prev.items, result.items),
      nextPage: result.nextPage,
    }));
    setStatus("idle");
  };
  const onSentinelInView = useEffectEvent(() => void loadMore());

  useEffect(() => {
    // After a failure only the button retries, so offline doesn't loop.
    const target = sentinel.current;
    if (!target || nextPage === null || status !== "idle") {
      return;
    }
    // A new observer per page on purpose: an observer fires only when the
    // sentinel crosses into view, but a new one reports it at once, so the
    // next page loads if the end of the grid is still showing.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          onSentinelInView();
        }
      },
      { rootMargin: "0px 0px 800px 0px" }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [nextPage, status]);

  return (
    <>
      <ul
        className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3"
        data-testid="discover-results"
        onClickCapture={(e) => {
          if (
            loaded.items.length > initial.items.length &&
            (e.target as Element).closest("a")
          ) {
            save(href, { ...loaded, scrollY: window.scrollY });
          }
        }}
      >
        {loaded.items.map((r) => (
          <li key={r.slug}>
            <RecipeCard recipe={r} />
          </li>
        ))}
      </ul>

      {nextPage !== null && (
        <div ref={sentinel} className="flex flex-col items-center gap-2">
          {status === "failed" && (
            <p role="alert" className="text-sm text-muted">
              Couldn&rsquo;t load more.
            </p>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void loadMore()}
            disabled={status === "loading"}
          >
            {status === "loading"
              ? "Loading…"
              : status === "failed"
                ? "Try again"
                : "Load more"}
          </Button>
        </div>
      )}
    </>
  );
};

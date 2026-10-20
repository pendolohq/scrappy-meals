"use client";

import {
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { cx } from "@/lib/cx";
import { dayParts, formatDay } from "@/lib/format";

const noSubscribe = () => () => {};

const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The index in `dates` of the day the URL's hash names, if any. */
const hashIndex = (dates: string[]) => {
  const i = dates.indexOf(decodeURIComponent(window.location.hash.slice(1)));
  return i === -1 ? null : i;
};

const slideLeft = (track: HTMLElement, i: number) => {
  const slides = track.children as HTMLCollectionOf<HTMLElement>;
  return slides[i].offsetLeft - slides[0].offsetLeft;
};

/**
 * Runs as the HTML arrives, before the page first paints, so the carousel
 * doesn't show Monday and then jump to today once React hydrates. The page
 * streams in behind `loading.tsx`, so the track may still sit in React's
 * hidden Suspense container, where it has no layout: it then waits, a frame
 * at a time (frames run before paint), until React moves it into place.
 * Client navigations don't run it; the layout effect positions the track then.
 */
const positionScript = (dates: string[], initial: number) =>
  `(() => {
  const t = document.currentScript.previousElementSibling;
  const i = ${JSON.stringify(dates)}.indexOf(decodeURIComponent(location.hash.slice(1)));
  let tries = 0;
  const place = () => {
    if (t.closest("[hidden]")) {
      if (tries++ < 600) requestAnimationFrame(place);
      return;
    }
    const s = t.children;
    t.scrollLeft = s[i === -1 ? ${initial} : i].offsetLeft - s[0].offsetLeft;
  };
  place();
})();`;

/**
 * One day at a time, for phones: a strip of the week's days over the day
 * cards (`children`, one per date, in order) side by side with scroll
 * snapping. Swiping moves the strip's selection and tapping a day scrolls to
 * it; the selected day is kept in the URL hash, so reloads and Back return
 * to it.
 */
export const DayCarousel = ({
  dates,
  today,
  initial,
  className,
  children,
}: {
  dates: string[];
  today: string;
  /** The day to open on when the hash doesn't name one. */
  initial: string;
  className?: string;
  children: React.ReactNode;
}) => {
  const track = useRef<HTMLElement>(null);
  const initialIndex = Math.max(dates.indexOf(initial), 0);
  const [selected, setSelected] = useState(initialIndex);
  // While a tapped day scrolls into view, the days it passes don't select.
  const target = useRef<number | null>(null);
  // False while hydrating (the script is already in the page and has run);
  // true when the carousel is created on the client, where React would only
  // warn about a script it never runs, so it's rendered inert.
  const clientRendered = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false
  );

  // The selection as the scroll handler sees it, between renders.
  const current = useRef(initialIndex);

  const select = (i: number) => {
    current.current = i;
    setSelected(i);
    window.history.replaceState(null, "", `#${dates[i]}`);
  };

  // Opens on the hash's day, or `initial`. Once per mount: the page keys the
  // carousel by week, and a refresh of the day cards mustn't pull it back.
  const open = useEffectEvent(() => {
    const el = track.current;
    if (!el) {
      return;
    }
    const start = hashIndex(dates) ?? initialIndex;
    el.scrollLeft = slideLeft(el, start);
    current.current = start;
    setSelected(start);
  });
  useLayoutEffect(() => open(), []);

  useLayoutEffect(() => {
    const el = track.current;
    if (!el) {
      return;
    }
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const left = el.scrollLeft;
        let i = 0;
        for (let j = 1; j < el.children.length; j++) {
          if (
            Math.abs(slideLeft(el, j) - left) <
            Math.abs(slideLeft(el, i) - left)
          ) {
            i = j;
          }
        }
        if (target.current !== null) {
          if (i !== target.current) {
            return;
          }
          target.current = null;
        }
        if (i !== current.current) {
          select(i);
        }
      });
    };
    // A swipe during a tapped day's scroll takes over from it.
    const release = () => {
      target.current = null;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("pointerdown", release);
    el.addEventListener("wheel", release, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("pointerdown", release);
      el.removeEventListener("wheel", release);
    };
  });

  const goTo = (i: number) => {
    const el = track.current;
    if (!el) {
      return;
    }
    target.current = i;
    select(i);
    el.scrollTo({
      left: slideLeft(el, i),
      behavior: reducedMotion() ? "instant" : "smooth",
    });
  };

  return (
    <div className={cx("space-y-3", className)}>
      <nav aria-label="Days of the week" className="grid grid-cols-7 gap-1">
        {dates.map((date, i) => {
          const { day, weekday } = dayParts(date);
          const isToday = date === today;
          const isSelected = i === selected;
          return (
            <a
              key={date}
              href={`#${date}`}
              aria-label={
                isToday ? `${formatDay(date)}, today` : formatDay(date)
              }
              aria-current={isSelected ? "true" : undefined}
              onClick={(e) => {
                e.preventDefault();
                goTo(i);
              }}
              className={cx(
                "flex min-h-tap flex-col items-center justify-center rounded-control py-1.5 transition",
                isSelected
                  ? "bg-accent text-accent-foreground shadow-card"
                  : "hover:bg-accent-soft",
                !isSelected && (isToday ? "text-highlight" : "text-foreground")
              )}
            >
              <span
                aria-hidden
                className={cx(
                  "text-[0.6875rem] font-semibold tracking-wider uppercase",
                  !isSelected && !isToday && "text-muted"
                )}
              >
                {weekday.slice(0, 1)}
              </span>
              <span
                aria-hidden
                className="font-serif text-lg leading-tight font-semibold tabular-nums"
              >
                {day}
              </span>
              <span
                aria-hidden
                className={cx(
                  "size-1 rounded-full",
                  isToday
                    ? isSelected
                      ? "bg-accent-foreground"
                      : "bg-highlight"
                    : "bg-transparent"
                )}
              />
            </a>
          );
        })}
      </nav>

      {/* `relative` keeps the cards' absolutely placed screen-reader text
          clipped here, or it widens the whole page. The larger scroll margin
          keeps the strip in view when a link lands on a day. */}
      <section
        ref={track}
        aria-label="Days"
        className="relative -mx-4 flex snap-x snap-mandatory scroll-px-4 [scrollbar-width:none] items-start gap-4 overflow-x-auto overscroll-x-contain px-4 pb-2 *:w-full *:shrink-0 *:snap-start *:snap-always *:scroll-mt-40! sm:-mx-6 sm:scroll-px-6 sm:px-6"
      >
        {children}
      </section>
      <script
        type={clientRendered ? "text/plain" : undefined}
        suppressHydrationWarning
        dangerouslySetInnerHTML={{
          __html: positionScript(dates, initialIndex),
        }}
      />
    </div>
  );
};

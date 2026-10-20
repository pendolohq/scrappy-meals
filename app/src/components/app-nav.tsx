"use client";

import {
  BookPlus,
  CalendarDays,
  ChartNoAxesColumn,
  type LucideIcon,
  Settings,
  ShoppingBasket,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cx } from "@/lib/cx";

type Item = {
  label: string;
  href: string;
  icon: LucideIcon;
  active: boolean;
};

const WEEK_PATH = /^\/week\/(\d{4}-\d{2}-\d{2})(\/[a-z]+)?/;

/**
 * Where each section lives. Shopping and adherence belong to a week: the one
 * on screen if there is one, else the current week (`currentWeek`).
 */
const useItems = (currentWeek: string): Item[] => {
  const pathname = usePathname();
  const match = WEEK_PATH.exec(pathname);
  const week = match?.[1] ?? currentWeek;
  const sub = match?.[2] ?? "";
  return [
    {
      label: "Week",
      href: match ? `/week/${week}` : "/week",
      icon: CalendarDays,
      active: pathname === "/week" || (Boolean(match) && sub === ""),
    },
    {
      label: "Shopping",
      href: `/week/${week}/shopping`,
      icon: ShoppingBasket,
      active: sub === "/shopping",
    },
    {
      label: "Adherence",
      href: `/week/${week}/adherence`,
      icon: ChartNoAxesColumn,
      active: sub === "/adherence",
    },
    {
      label: "Add recipe",
      href: "/recipes/new",
      icon: BookPlus,
      active: pathname.startsWith("/recipes"),
    },
    {
      label: "Settings",
      href: "/settings",
      icon: Settings,
      active: pathname.startsWith("/settings"),
    },
  ];
};

/** Wide screens: the sidebar's list. */
export const SideNav = ({ currentWeek }: { currentWeek: string }) => (
  <nav aria-label="Main">
    <ul className="space-y-1">
      {useItems(currentWeek).map(({ label, href, icon: Icon, active }) => (
        <li key={label}>
          <Link
            href={href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex min-h-tap items-center gap-3 rounded-control px-3 text-[0.9375rem] font-medium transition",
              active
                ? "bg-accent-soft text-accent"
                : "text-foreground/80 hover:bg-sunken hover:text-foreground"
            )}
          >
            <Icon className="size-5 shrink-0" strokeWidth={1.75} aria-hidden />
            {label}
          </Link>
        </li>
      ))}
    </ul>
  </nav>
);

/**
 * Phones: a tab bar along the bottom, above the home indicator. "Add recipe"
 * lives in the top bar instead, to keep four tabs.
 */
export const TabBar = ({ currentWeek }: { currentWeek: string }) => (
  <nav
    aria-label="Main"
    className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
  >
    <ul className="mx-auto grid max-w-lg grid-cols-4">
      {useItems(currentWeek)
        .filter((i) => i.label !== "Add recipe")
        .map(({ label, href, icon: Icon, active }) => (
          <li key={label}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={cx(
                "flex h-16 flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium transition",
                active ? "text-accent" : "text-muted hover:text-foreground"
              )}
            >
              <Icon
                className="size-6"
                strokeWidth={active ? 2 : 1.6}
                aria-hidden
              />
              {label}
            </Link>
          </li>
        ))}
    </ul>
  </nav>
);

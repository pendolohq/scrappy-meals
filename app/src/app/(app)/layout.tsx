import { BookPlus, Settings } from "lucide-react";
import Link from "next/link";

import { SideNav, TabBar } from "@/components/app-nav";
import { InstallBanner } from "@/components/install-hint";
import { PrecacheWeek } from "@/components/pwa";
import { SignOut } from "@/components/sign-out";
import { Brand, BrandMark } from "@/components/ui/brand";
import { iconButtonClass } from "@/components/ui/icon-button";
import { today, weekStartOf } from "@/server/domain/week";
import { requireUser } from "@/server/session";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const currentWeek = weekStartOf(today());

  return (
    <div className="lg:flex">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-8 border-r border-border px-4 py-6 lg:flex">
        <Link href="/week" className="px-2">
          <Brand />
        </Link>
        <div className="flex-1">
          <SideNav currentWeek={currentWeek} />
        </div>
        <SignOut name={user.name} />
      </aside>

      <header className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-border/60 bg-background/90 px-3 pt-[env(safe-area-inset-top)] backdrop-blur-md lg:hidden">
        <Link
          href="/week"
          className="flex min-h-tap items-center gap-2 px-1 font-serif text-lg font-semibold"
        >
          <BrandMark className="size-8" />
          Scrappy Meals
        </Link>
        <div className="flex items-center">
          <Link
            href="/recipes/new"
            aria-label="Add recipe"
            title="Add recipe"
            className={iconButtonClass()}
          >
            <BookPlus className="size-5" aria-hidden />
          </Link>
          <Link
            href="/settings"
            aria-label="Settings"
            title="Settings"
            className={iconButtonClass()}
          >
            <Settings className="size-5" aria-hidden />
          </Link>
          <SignOut name={user.name} compact />
        </div>
      </header>

      {/* The week grids (`data-wide`) need the room a wide screen has. */}
      <main className="mx-auto w-full max-w-3xl min-w-0 px-4 pt-5 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-10 lg:pt-10 lg:pb-16 xl:has-[[data-wide]]:max-w-none">
        <InstallBanner />
        {children}
      </main>

      <PrecacheWeek week={currentWeek} />

      <TabBar currentWeek={currentWeek} />
    </div>
  );
}

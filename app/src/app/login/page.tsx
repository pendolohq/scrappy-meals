import { Terminal } from "lucide-react";
import Image from "next/image";
import { redirect } from "next/navigation";

import { Brand } from "@/components/ui/brand";
import { Card } from "@/components/ui/card";
import { getDb } from "@/server/db/client";
import { currentUser } from "@/server/session";
import { countUsers } from "@/server/users";

import { LoginForm } from "./login-form";
// Our own stock photo (Unsplash licence: free to use, no attribution needed).
// Swap the file to change it; a static import gives it a blur placeholder.
import welcome from "./welcome.webp";

export const dynamic = "force-dynamic";

const NoAccounts = () => (
  <Card className="space-y-3">
    <div className="flex items-center gap-3">
      <span className="flex size-10 items-center justify-center rounded-full bg-highlight-soft text-highlight">
        <Terminal className="size-5" aria-hidden />
      </span>
      <h2 className="font-serif text-heading font-semibold">No accounts yet</h2>
    </div>
    <p className="text-sm text-muted">
      Accounts are created on the server. Run this, then come back here to sign
      in:
    </p>
    <pre className="overflow-x-auto rounded-control bg-sunken px-3 py-2.5 font-mono text-xs">
      docker compose exec app scrappy user add
    </pre>
  </Card>
);

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (await currentUser()) {
    redirect("/");
  }
  const { next } = await searchParams;
  const noUsers = (await countUsers(getDb())) === 0;

  return (
    <div className="flex min-h-dvh flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* One photo: a banner over the form on phones, the right half on wide screens. */}
      <aside
        className="relative px-3 pt-[max(env(safe-area-inset-top),0.75rem)] lg:order-last lg:p-3"
        aria-hidden
      >
        <div className="relative h-44 overflow-hidden rounded-card bg-sunken sm:h-56 lg:h-full lg:rounded-[2rem]">
          <Image
            src={welcome}
            alt=""
            fill
            placeholder="blur"
            preload
            sizes="(min-width: 1024px) 55vw, 100vw"
            className="object-cover"
          />
          <div className="absolute inset-0 bg-linear-to-b from-scrim/45 via-transparent to-transparent lg:hidden" />
          <Brand className="absolute top-4 left-4 text-on-photo lg:hidden" />
          <div className="absolute inset-x-0 bottom-0 hidden bg-linear-to-t from-scrim/60 via-scrim/25 to-transparent px-10 pt-32 pb-10 lg:block">
            <p className="max-w-md font-serif text-title font-medium text-balance text-on-photo">
              Plan it together, cook it once, shop for it in one go.
            </p>
          </div>
        </div>
      </aside>

      <main className="flex flex-1 flex-col px-4 pb-[max(env(safe-area-inset-bottom),1.5rem)] sm:px-10 lg:px-16 lg:pt-8">
        <div className="hidden lg:block">
          <Brand />
        </div>

        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 py-8 lg:gap-8 lg:py-10">
          <div className="space-y-3">
            <h1 className="font-serif text-display font-semibold">
              {noUsers ? "Welcome" : "Welcome back"}
            </h1>
            <p className="text-muted">
              The week&apos;s meals for the whole household: who eats what, how
              it adds up, and one shopping list.
            </p>
          </div>
          {noUsers ? (
            <NoAccounts />
          ) : (
            <Card className="p-5 sm:p-6">
              <LoginForm next={next} />
            </Card>
          )}
        </div>

        <p className="text-center text-xs text-muted lg:text-left">
          Recipes and shopping lists live in Mealie.
        </p>
      </main>
    </div>
  );
}

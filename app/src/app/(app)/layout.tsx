import Link from "next/link";

import { SignOut } from "@/components/sign-out";
import { requireUser } from "@/server/session";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  return (
    <div className="mx-auto max-w-3xl px-4 pb-[env(safe-area-inset-bottom)]">
      <header className="flex items-center justify-between gap-4 py-4">
        <nav className="flex gap-4 text-sm font-medium">
          <Link href="/week">Plan</Link>
          <Link href="/recipes/new">Add recipe</Link>
          <Link href="/settings">Settings</Link>
        </nav>
        <SignOut name={user.name} />
      </header>
      <main>{children}</main>
    </div>
  );
}

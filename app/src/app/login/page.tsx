import { redirect } from "next/navigation";

import { getDb } from "@/server/db/client";
import { currentUser } from "@/server/session";
import { countUsers } from "@/server/users";

import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

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
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <h1 className="mb-6 text-2xl font-semibold">Scrappy Meals</h1>
      {noUsers ? (
        <div className="space-y-2 rounded-lg border border-border bg-card p-4 text-sm">
          <p className="font-medium">No accounts yet.</p>
          <p className="text-muted">Create one on the server:</p>
          <pre className="overflow-x-auto rounded bg-background p-2">
            docker compose exec app scrappy user add
          </pre>
        </div>
      ) : (
        <LoginForm next={next} />
      )}
    </main>
  );
}

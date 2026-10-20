"use client";

import Link from "next/link";

// Anything a page throws (Postgres restarting, a bug) lands here, inside the
// app's header, so there is always a way to retry or get back to the plan.
export default function AppError({ retry }: { retry: () => void }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col gap-3 py-12">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted">
        This page couldn&apos;t load. It may work if you try again in a moment.
      </p>
      <button
        type="button"
        onClick={() => retry()}
        className="w-full rounded-lg bg-accent px-4 py-2 font-medium text-white dark:text-stone-900"
      >
        Try again
      </button>
      <Link href="/week" className="text-center text-sm text-accent">
        Back to this week
      </Link>
    </div>
  );
}

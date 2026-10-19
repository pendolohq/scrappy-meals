"use client";

import "./globals.css";

// Replaces the root layout when it fails, so it brings its own <html>.
export default function GlobalError({ retry }: { retry: () => void }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-3 px-4">
          <title>Scrappy Meals</title>
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <button
            type="button"
            onClick={() => retry()}
            className="w-full rounded-lg bg-accent px-4 py-2 font-medium text-white dark:text-stone-900"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}

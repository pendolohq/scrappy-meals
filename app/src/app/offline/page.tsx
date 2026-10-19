export const dynamic = "force-static";

// Served by the service worker when you're offline and the page isn't cached yet.
export default function Offline() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-2 px-4">
      <h1 className="text-xl font-semibold">You&apos;re offline</h1>
      <p className="text-sm text-muted">
        Weeks you&apos;ve opened recently are still available. Changes need a connection.
      </p>
      {/* oxlint-disable-next-line nextjs/no-html-link-for-pages -- a full load lets the service worker serve the cached week */}
      <a href="/week" className="text-sm text-accent">
        Open this week
      </a>
    </main>
  );
}

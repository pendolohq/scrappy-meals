// Service worker: makes the app installable and keeps recently viewed weeks
// readable offline. Hand-written and small on purpose.
const VERSION = "v1";
const STATIC = `static-${VERSION}`;
const PAGES = `pages-${VERSION}`;
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC)
      .then((c) => c.addAll([OFFLINE_URL, "/icons/icon-192.png"]))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== STATIC && k !== PAGES)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Signing out clears cached pages, which contain the household's plan.
self.addEventListener("message", (event) => {
  if (event.data === "clear-pages") {
    event.waitUntil(caches.delete(PAGES));
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") {
    return;
  }
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  // Build output is content-hashed: cache first.
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/")
  ) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone(); // clone before the body is handed to the page
              caches.open(STATIC).then((c) => c.put(req, copy));
            }
            return res;
          })
      )
    );
    return;
  }

  // Week pages: always try the network, fall back to the last copy we saw.
  if (req.mode === "navigate" && url.pathname.startsWith("/week")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Only keep real pages, not redirects to the login screen.
          if (res.ok && !res.redirected) {
            const copy = res.clone();
            caches.open(PAGES).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(
          async () =>
            (await caches.match(req)) || (await caches.match(OFFLINE_URL))
        )
    );
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
  }
});

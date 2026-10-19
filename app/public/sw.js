// Service worker: makes the app installable and keeps recently viewed weeks
// readable offline. Hand-written and small on purpose.
const VERSION = "v1";
const STATIC = `static-${VERSION}`;
const PAGES = `pages-${VERSION}`;
const OFFLINE_URL = "/offline";
// Every deploy brings new content-hashed chunks; keep the newest ones only.
const MAX_STATIC = 200;

const trim = async (cache, max) => {
  const keys = await cache.keys(); // oldest first
  await Promise.all(keys.slice(0, -max).map((k) => cache.delete(k)));
};

// "/week" and "/" only redirect, so they're never cached themselves. Offline,
// open this week's page (computed in local time, like the phone's calendar).
const pad = (n) => String(n).padStart(2, "0");
const thisWeek = () => {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `/week/${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

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
              caches
                .open(STATIC)
                .then((c) => c.put(req, copy).then(() => trim(c, MAX_STATIC)));
            }
            return res;
          })
      )
    );
    return;
  }

  // Week pages: always try the network, fall back to the last copy we saw.
  const entry = url.pathname === "/" || url.pathname === "/week";
  if (req.mode === "navigate" && (entry || url.pathname.startsWith("/week"))) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Only keep real pages, not redirects (to the login screen, say).
          if (res.ok && !res.redirected) {
            const copy = res.clone();
            caches.open(PAGES).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(
          async () =>
            (await caches.match(req)) ||
            (entry && (await caches.match(thisWeek(), { ignoreVary: true }))) ||
            (await caches.match(OFFLINE_URL))
        )
    );
    return;
  }

  if (req.mode === "navigate") {
    // The server sends a page request without a session to /login?next=...:
    // the session ended (signed out elsewhere, password changed), so the
    // cached plan must not stay readable offline on this device.
    if (url.pathname === "/login" && url.searchParams.has("next")) {
      event.waitUntil(caches.delete(PAGES));
    }
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
  }
});

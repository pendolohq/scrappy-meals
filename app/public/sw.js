// Service worker: makes the app installable and keeps this week readable
// offline (the week, its meal pages and the shopping list). Hand-written and
// small on purpose.
// Bump VERSION with every change to this file: it's how the browser sees an
// update, and it drops the caches the old version filled.
const VERSION = "v4";
const STATIC = `static-${VERSION}`;
const PAGES = `pages-${VERSION}`;
// Recipe photos from /api/recipe-images: user data, cleared with the pages.
const IMAGES = `images-${VERSION}`;
const OFFLINE_URL = "/offline";
// Every deploy brings new content-hashed chunks; keep the newest ones only.
const MAX_STATIC = 200;
const MAX_IMAGES = 100;
// How stale a cached page may be before precaching fetches it again. The
// shopping list is always fetched; the week page only when it wasn't just
// loaded; a meal page changes only with portions. Opening a page online always
// refreshes it.
const WEEK_MAX_AGE = 10 * 1000;
const MEAL_MAX_AGE = 30 * 60 * 1000;

const trim = async (cache, max) => {
  const keys = await cache.keys(); // oldest first
  await Promise.all(keys.slice(0, -max).map((k) => cache.delete(k)));
};

const clearUserData = () =>
  Promise.all([caches.delete(PAGES), caches.delete(IMAGES)]);

// Shortcuts and "/" only redirect, so they're never cached themselves.
// Offline, they open the matching page of this week (computed in local time,
// like the phone's calendar).
const ENTRIES = new Map([
  ["/", ""],
  ["/week", ""],
  ["/shopping", "/shopping"],
]);
const pad = (n) => String(n).padStart(2, "0");
const thisWeek = () => {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `/week/${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Pages are kept by URL alone: Next.js varies them on its router headers,
// which a navigation never sends.
const MATCH = { ignoreVary: true };

/**
 * A page's HTML for precaching, from the cache while it's younger than
 * `maxAge` ms, else fetched into it. Null when it isn't a page (a redirect to
 * the login screen, say, or no connection).
 */
const getPage = async (pages, url, maxAge) => {
  const hit = await pages.match(url, MATCH);
  const age = Date.now() - Date.parse(hit?.headers.get("Date") ?? "");
  if (hit && age < maxAge) {
    return hit.text();
  }
  const res = await fetch(url).catch(() => null);
  if (!res?.ok || res.redirected) {
    if (res?.redirected && new URL(res.url).pathname === "/login") {
      await clearUserData(); // the session ended
    }
    return null;
  }
  await pages.put(url, res.clone());
  return res.text();
};

const fetchInto = async (cacheName, urls) => {
  const cache = await caches.open(cacheName);
  await Promise.all(
    urls.map(async (url) => {
      if (await cache.match(url)) {
        return;
      }
      const res = await fetch(url).catch(() => null);
      if (res?.ok) {
        await cache.put(url, res);
      }
    })
  );
  return cache;
};

/**
 * Keeps a week's page, its shopping list and each of its meal pages cached,
 * with the scripts and photos they need, so the kitchen and the shop work
 * without a signal. Runs whenever a page asks (each load, and when the app
 * comes back to the foreground), so a meal planned a moment ago is there too;
 * meal pages it already has are refetched only every MEAL_MAX_AGE.
 */
const precacheWeek = async (week) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    return;
  }
  const pages = await caches.open(PAGES);
  const base = `/week/${week}`;
  const weekHtml = await getPage(pages, base, WEEK_MAX_AGE);
  if (weekHtml === null) {
    return;
  }
  const meals = new Set(
    [...weekHtml.matchAll(/href="(\/week\/[\d-]+\/meals\/[^"?#]+)"/g)]
      .map(([, href]) => href)
      .filter((href) => href.startsWith(`${base}/meals/`))
  );
  const html = [
    weekHtml,
    await getPage(pages, `${base}/shopping`, 0),
    ...(await Promise.all(
      [...meals].map((url) => getPage(pages, url, MEAL_MAX_AGE))
    )),
  ].join("\n");

  // Pages opened offline need their own chunks to hydrate.
  const chunks = new Set(html.match(/\/_next\/static\/[^"'\s\\)]+/g));
  const photos = new Set(html.match(/\/api\/recipe-images\/[0-9a-f-]+/gi));
  await Promise.all([
    fetchInto(STATIC, [...chunks]).then((c) => trim(c, MAX_STATIC)),
    fetchInto(IMAGES, [...photos]).then((c) => trim(c, MAX_IMAGES)),
  ]);
};

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC)
      .then((c) => c.addAll([OFFLINE_URL, "/icons/icon-192.png"]))
  );
  // No skipWaiting() here: swapping workers under an open page would leave it
  // asking for chunks of a build that's gone. The page offers a reload instead.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== STATIC && k !== PAGES && k !== IMAGES)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  const { data } = event;
  // Signing out clears cached pages and photos, which are the household's.
  if (data === "clear-pages") {
    event.waitUntil(clearUserData());
  } else if (data === "skip-waiting") {
    self.skipWaiting(); // the person chose to reload into the new version
  } else if (data?.type === "precache") {
    event.waitUntil(precacheWeek(data.week));
  }
});

const networkFirst = (event, cacheName, fallback) =>
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        // Only keep real responses, not redirects (to the login screen, say).
        if (res.ok && !res.redirected) {
          const copy = res.clone(); // clone before the body is handed to the page
          caches.open(cacheName).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(
        async () =>
          (await caches.match(event.request, MATCH)) ||
          (fallback && (await fallback()))
      )
  );

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") {
    return;
  }
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  // Build output is content-hashed: cache first. So is the barcode reader's
  // wasm (its version is in the name), kept so a second scan works on a bad
  // connection.
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/zxing/")
  ) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            // Not a redirect: an ended session answers with the login page.
            if (res.ok && !res.redirected) {
              const copy = res.clone();
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

  if (url.pathname.startsWith("/api/recipe-images/")) {
    networkFirst(event, IMAGES);
    return;
  }

  // Week pages: always try the network, fall back to the last copy we saw.
  const entry = ENTRIES.get(url.pathname);
  if (
    req.mode === "navigate" &&
    (entry !== undefined || url.pathname.startsWith("/week"))
  ) {
    networkFirst(
      event,
      PAGES,
      async () =>
        (entry !== undefined &&
          (await caches.match(thisWeek() + entry, MATCH))) ||
        (await caches.match(OFFLINE_URL))
    );
    return;
  }

  if (req.mode === "navigate") {
    // The server sends a page request without a session to /login?next=...:
    // the session ended (signed out elsewhere, password changed), so the
    // cached plan must not stay readable offline on this device.
    if (url.pathname === "/login" && url.searchParams.has("next")) {
      event.waitUntil(clearUserData());
    }
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
  }
});

/* Wattwise service worker.
 *
 * Scope is narrow on purpose: make the app shell open without a network, and
 * nothing else.
 *
 * TELEMETRY IS NEVER CACHED — THIS IS THE LOAD-BEARING RULE.
 * Everything else in this project refuses to show a number it cannot stand
 * behind: the gauge greys out when a reading goes stale, the forecaster serves
 * the naive baseline rather than a model outside its validated domain, the
 * background scene stops animating when the meter is not reporting. A service
 * worker that replayed a cached /api/v1 response would undo all of that in one
 * line — a viewer would see last hour's watts rendered as live, with no way to
 * tell. So API requests go to the network or they fail, and the UI's existing
 * "Offline" and stale-reading states handle the failure honestly.
 *
 * No build step and no dependency: next-pwa does not support Next 16's app
 * router cleanly, and a precache manifest of hashed chunks would need one.
 * Runtime caching needs neither.
 */

const VERSION = "wattwise-v2";
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;

// The document served when a navigation happens with no network at all.
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll([OFFLINE_URL, "/manifest.json"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => !k.startsWith(VERSION))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // ---- 1. Anything that is not this origin: leave it entirely alone. -------
  // The API lives on another port, so this covers it — see the rule at the top.
  // Fonts and any other cross-origin asset are also left to the browser.
  if (url.origin !== self.location.origin) return;

  // ---- 2. Never touch API traffic, even if it is ever same-origin. ---------
  if (url.pathname.startsWith("/api/")) return;

  // ---- 3. Hashed build output: cache-first. --------------------------------
  // /_next/static/* filenames contain a content hash, so a cached entry can
  // never be stale — a new build produces a new URL.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(ASSETS).then((c) => c.put(request, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // ---- 4. Navigations: network-first, cache as a fallback. ----------------
  // Network-first rather than cache-first so a deploy is picked up on the next
  // load instead of being pinned until the cache is cleared.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(request, copy));
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || caches.match(OFFLINE_URL);
        }),
    );
    return;
  }

  // ---- 5. Same-origin icons and static files: cache-first. -----------------
  if (url.pathname.startsWith("/icons/") || url.pathname === "/favicon.ico") {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(ASSETS).then((c) => c.put(request, copy));
            }
            return res;
          }),
      ),
    );
  }
});

/* Lunch Book service worker.
 *
 * App files (html/js/css/icons): served from cache instantly, refreshed in the background
 *   (stale-while-revalidate). If a refreshed file differs, open pages get an "app-updated" message
 *   and offer a one-tap Refresh — so the app opens fast and never gets stuck on an old version.
 * Data (data/*.json): network first, cached copy if offline or slow — numbers are always fresh when online.
 * api/*: never cached (saving must always reach the local server).
 *
 * Bump VERSION only if you want to force every phone to drop its old cache.
 */
const VERSION = "v1";
const SHELL = `lunch-shell-${VERSION}`;
const DATA = `lunch-data-${VERSION}`;
const FONTS = `lunch-fonts-${VERSION}`;
const NETWORK_TIMEOUT = 4000;

const SHELL_FILES = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "ledger.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, DATA, FONTS]);
    for (const key of await caches.keys()) if (!keep.has(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") self.skipWaiting();
});

/** Cache key without the ?t=… cache-buster the app adds. */
function cleanKey(request) {
  const url = new URL(request.url);
  url.search = "";
  return url.toString();
}

let notifyTimer = null;
/** Tell open pages that newer app files were downloaded (once, even if several files changed). */
function notifyUpdated() {
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(async () => {
    for (const client of await self.clients.matchAll({ type: "window" })) client.postMessage({ type: "app-updated" });
  }, 800);
}

async function staleWhileRevalidate(request, cacheName, event) {
  const cache = await caches.open(cacheName);
  const key = cleanKey(request);
  const cached = await cache.match(key);
  // copy taken now: `cached` itself is handed to the page below and its body gets used up
  const before = cached ? cached.clone() : null;
  const fresh = fetch(request)
    .then(async (res) => {
      if (res.ok) {
        await cache.put(key, res.clone());
        // compare with what the page is using right now (app files are small)
        if (before && !/\.(png|jpe?g|webp|ico)$/i.test(key)) {
          const [a, b] = await Promise.all([before.text(), res.clone().text()]);
          if (a !== b) notifyUpdated();
        }
      }
      return res;
    })
    .catch((error) => { console.warn("[sw] background refresh failed", key, error); return null; });
  if (event) event.waitUntil(fresh);
  return cached || (await fresh) || Response.error();
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const key = cleanKey(request);
  try {
    const res = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), NETWORK_TIMEOUT))
    ]);
    if (res.ok) cache.put(key, res.clone());
    return res;
  } catch {
    const cached = await cache.match(key);
    if (cached) {
      // tell the page it is looking at a saved copy
      const headers = new Headers(cached.headers);
      headers.set("X-From-Cache", "1");
      return new Response(await cached.blob(), { status: 200, headers });
    }
    return Response.error();
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok || res.type === "opaque") cache.put(request, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin === "https://fonts.googleapis.com" || url.origin === "https://fonts.gstatic.com") {
    event.respondWith(cacheFirst(request, FONTS));
    return;
  }
  if (url.origin !== self.location.origin) return;

  const scope = new URL(self.registration.scope).pathname;
  const rel = url.pathname.startsWith(scope) ? url.pathname.slice(scope.length) : url.pathname;

  if (rel.startsWith("api/")) return; // always live
  if (rel.startsWith("data/")) {
    event.respondWith(networkFirst(request, DATA));
    return;
  }
  if (request.mode === "navigate") {
    // any page load → the app shell, instantly from cache (keeps working offline)
    event.respondWith(
      staleWhileRevalidate(new Request(new URL("index.html", self.registration.scope)), SHELL, event)
    );
    return;
  }
  event.respondWith(staleWhileRevalidate(request, SHELL, event));
});

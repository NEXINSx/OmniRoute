/* OmniRoute Control Room Service Worker
 * Netzwerk-first für Navigationen (immer aktuelle Version),
 * Cache-Fallback für Offline-Nutzung. Statische Assets werden
 * im Cache gehalten, aber bei jedem Lauf aktualisiert. */
const CACHE = "omniroute-ui-v2";
const CORE = [
  "/",
  "/static/index.html",
  "/static/manifest.webmanifest",
  "/static/icon-192.png",
  "/static/icon-512.png",
  "/static/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API-Aufrufe nie cachen (live Daten)
  if (
    url.pathname.startsWith("/agents") ||
    url.pathname.startsWith("/orca") ||
    url.pathname.startsWith("/kanban") ||
    url.pathname.startsWith("/projects") ||
    url.pathname.startsWith("/ledger") ||
    url.pathname.startsWith("/artifacts") ||
    url.pathname.startsWith("/health") ||
    url.pathname.startsWith("/memory")
  )
    return;

  // Navigation: Netzwerk zuerst, Offline-Fallback auf gecachte Shell
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put("/", copy));
          return response;
        })
        .catch(() => caches.match("/"))
    );
    return;
  }

  // Statische Assets: Cache-first mit Hintergrund-Refresh
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

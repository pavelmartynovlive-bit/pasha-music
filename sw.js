const CACHE_PREFIX = "pasha-music-github-pages-";
const CACHE = `${CACHE_PREFIX}v74`;
// Animations enter the cache when the page needs them. Preloading both during
// installation would compete with the first visible image and the app shell.
const APP_SHELL = ["./", "./music/", "./music/app.js?v=62", "./music/artist.css?v=1", "./music/assets/cat-poster.webp?v=1", "./styles.css?v=64", "./manifest.webmanifest?v=2", "./icons/icon-180.png?v=2", "./icons/icon-192.png?v=2", "./icons/icon-512.png?v=2"];
const NAVIGATION_TIMEOUT = 1500;
const REUSABLE_ANIMATIONS = ["./music/assets/cat-idle.webp?v=5", "./music/assets/cat-playing.webp?v=6"];

async function cacheResponse(request, response, event) {
  if (response.ok && response.type !== "opaque") {
    const copy = response.clone();
    event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {}));
  }
  return response;
}

async function fetchAndCache(request, event, fresh = false) {
  const response = await fetch(fresh ? new Request(request, { cache: "no-store" }) : request);
  return cacheResponse(request, response, event);
}

async function cachedAsset(request, event) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  return cached || fetchAndCache(request, event);
}

async function navigation(request, event) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const network = fetchAndCache(request, event, true);
  // Keep refreshing the document even when a slow connection makes us use the
  // installed copy. Versioned JS/CSS are served directly from their cache.
  event.waitUntil(network.catch(() => {}));
  if (!cached) return network;
  let timer;
  try {
    return await Promise.race([
      network.catch(() => cached),
      new Promise((resolve) => { timer = setTimeout(() => resolve(cached), NAVIGATION_TIMEOUT); }),
    ]);
  } finally { clearTimeout(timer); }
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then(async (cache) => {
    // One temporarily unavailable icon must not prevent the new worker from
    // installing. Successful files are still ready for the next launch.
    await Promise.allSettled(APP_SHELL.map((path) => cache.add(new URL(path, self.registration.scope))));
    await self.skipWaiting();
  }));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then(async (keys) => {
    const previousKeys = keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE);
    const cache = await caches.open(CACHE);
    // These exact animation versions did not change. Keep downloaded copies
    // through an app-shell update, without bringing old JS/CSS into this cache.
    await Promise.all(REUSABLE_ANIMATIONS.map(async (path) => {
      const url = new URL(path, self.registration.scope);
      if (await cache.match(url)) return;
      for (const key of [...previousKeys].reverse()) {
        const previous = await caches.open(key);
        const response = await previous.match(url);
        if (response?.ok) { await cache.put(url, response); return; }
      }
    }).map((migration) => migration.catch(() => {})));
    await Promise.all(previousKeys.map((key) => caches.delete(key)));
    await self.clients.claim();
  }));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  if (event.request.headers.has("Authorization") || event.request.cache === "no-store" || /\/api(?:\/|$)/.test(url.pathname)) return;
  if (event.request.mode === "navigate" || event.request.destination === "document") {
    event.respondWith(navigation(event.request, event));
  } else {
    event.respondWith(cachedAsset(event.request, event));
  }
});

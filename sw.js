const CACHE = "pasha-music-github-pages-v27";
const APP_SHELL = ["./", "./music/", "./music/app.js?v=27", "./music/assets/cat-idle.webp", "./music/assets/cat-playing.webp?v=2", "./styles.css?v=27", "./manifest.webmanifest", "./icons/icon-180.png", "./icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL.map((path) => new URL(path, self.registration.scope)))));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  const networkRequest = new Request(event.request, { cache: "no-store" });
  event.respondWith(fetch(networkRequest).then((response) => {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request)));
});

// Isolate this experiment from the music application's asset cache, including
// cached full responses to Range requests. Never cache experimental audio.
self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", event => {
  if (new URL(event.request.url).origin === self.location.origin)
    event.respondWith(fetch(new Request(event.request, { cache: "no-store" })));
});

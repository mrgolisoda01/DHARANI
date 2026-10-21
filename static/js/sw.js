/* ============================================================
   sw.js — minimal "no-op / self-cleanup" service worker
   ------------------------------------------------------------
   This intentionally caches NOTHING. Its only jobs are:
     1) take control of open pages right away,
     2) delete any caches left by older service workers,
     3) let every request go straight to the network (always
        fresh code — no stale admin/API/JS pages).
   This removes the old "Failed to convert value to 'Response'"
   and FetchEvent errors, and ends cache-related staleness.
   ============================================================ */

// Install: activate immediately, don't wait for old SW to release.
self.addEventListener('install', function (event) {
  self.skipWaiting();
});

// Activate: wipe every old cache and take control of all clients.
self.addEventListener('activate', function (event) {
  event.waitUntil(
    (async function () {
      try {
        var keys = await caches.keys();
        await Promise.all(keys.map(function (k) { return caches.delete(k); }));
      } catch (e) { /* ignore */ }
      try {
        await self.clients.claim();
      } catch (e) { /* ignore */ }
    })()
  );
});

// Fetch: do nothing — let the browser handle it normally (network).
// We deliberately do NOT call event.respondWith(), so there is no
// chance of returning an invalid Response. Every request is fresh.
self.addEventListener('fetch', function (event) {
  return;
});

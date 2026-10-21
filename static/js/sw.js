// SAFC-LMS service worker — no-op / self-cleanup
// Caches nothing. Clears old caches. Lets every request hit the network.
self.addEventListener('install', function (event) { self.skipWaiting(); });
self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    try { var keys = await caches.keys(); await Promise.all(keys.map(function (k) { return caches.delete(k); })); } catch (e) {}
    try { await self.clients.claim(); } catch (e) {}
  })());
});
self.addEventListener('fetch', function (event) { return; });

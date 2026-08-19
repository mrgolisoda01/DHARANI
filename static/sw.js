// SAFC-LMS service worker
// Minimal + safe: makes the app installable and lets it open when offline
// shows a simple message, but does NOT aggressively cache pages (so the
// portal always loads the latest version from the server when online).

const CACHE = 'safc-lms-v1';
const OFFLINE_URLS = [
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  // activate immediately
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(OFFLINE_URLS)).catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  // clean old caches
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // only handle GET
  if (req.method !== 'GET') return;

  // network-first: always try the live server, fall back to cache for icons
  event.respondWith(
    fetch(req).catch(() => caches.match(req))
  );
});

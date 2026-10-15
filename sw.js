const CACHE_NAME = 'lastmusic-v2'; // Bump this version (v2 -> v3) whenever you push new changes
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './cloud-songs.js',
  './manifest.json',
  './icon-192.png'
];

// Install: cache new assets
self.addEventListener('install', (event) => {
  self.skipWaiting(); // Forces the waiting service worker to become active
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
});

// Activate: delete all old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim()) // Immediately take control of all open tabs
  );
});

// Fetch: Network-first for HTML/JS during development, falling back to cache
self.addEventListener('fetch', (event) => {
  // Avoid caching non-GET requests or external streaming blobs
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // Update cache dynamically with latest network response
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request)) // Fallback to cache only when offline
  );
});

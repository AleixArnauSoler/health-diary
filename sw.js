// Diary – service worker.
// Keeps a copy of the app on the phone so it opens offline.
// Strategy: always try the network first (so new versions arrive as soon as you're online),
// and fall back to the stored copy when there is no connection.

const CACHE = 'diary-v4';

const APP_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/logic.js',
  './js/db.js',
  './js/sync.js',
  './js/config.js',
  './js/settings.js',
  './js/day.js',
  './js/form.js',
  './js/calendar.js',
  './js/demo.js',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  // Only handle this app's own files; anything else (e.g. GitHub's API) goes straight to the network.
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request.url, { cache: 'no-cache' })
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request, { ignoreSearch: true }).then((stored) => {
          if (stored) return stored;
          return request.mode === 'navigate' ? caches.match('./index.html') : Response.error();
        })
      )
  );
});

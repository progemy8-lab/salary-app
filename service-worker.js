const CACHE_NAME = 'salary-app-cache-v25';
const FILES_TO_CACHE = [
  './',
  './index.html',
  './icon-180.png',
  './icon-maskable-512.png',
  './favicon-32.png',
  './manifest.json',
  './extras.js',
  './config.js',
  './sync.js',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(FILES_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// شبكة أولًا (عشان التحديثات توصل)، ولو أوفلاين نرجع للكاش
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const reqUrl = new URL(event.request.url);
  if (reqUrl.origin !== location.origin && reqUrl.hostname !== 'cdn.jsdelivr.net') return;
  event.respondWith(
    fetch(event.request).then((res) => {
      const u = new URL(event.request.url);
      const cacheable = u.origin === location.origin || u.hostname === 'cdn.jsdelivr.net';
      if (res && (res.ok || res.type === 'opaque') && cacheable) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(event.request, copy));
      }
      return res;
    }).catch(() => caches.match(event.request))
  );
});

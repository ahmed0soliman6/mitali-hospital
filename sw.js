const CACHE_NAME = 'hospital-v1.3.47-firestore-only';
const urlsToCache = ['./index.html', './manifest.json', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './favicon-32.png'];

function isApiRequest(request) {
  try {
    return new URL(request.url).pathname.startsWith('/api/');
  } catch (_) {
    return false;
  }
}

function isNavigationRequest(request) {
  return request.mode === 'navigate' || request.destination === 'document';
}

async function networkFirstDocument(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (!response || !response.ok) throw new Error('document-fetch-failed');
    await cache.put(request, response.clone());
    return response;
  } catch (_) {
    return (await cache.match(request)) ||
      (await cache.match(new URL('./index.html', self.registration.scope).toString())) ||
      Response.error();
  }
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('✅ Service Worker installed');
      return cache.addAll(urlsToCache);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames =>
      Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) return caches.delete(cacheName);
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || isApiRequest(event.request)) return;
  if (isNavigationRequest(event.request)) {
    event.respondWith(networkFirstDocument(event.request));
    return;
  }
  event.respondWith(
    caches.match(event.request).then(response => {
      if (response) return response;
      return fetch(event.request)
        .then(response => {
          if (!response || response.status !== 200) return response;
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache));
          return response;
        })
        .catch(() => caches.match(event.request));
    })
  );
});

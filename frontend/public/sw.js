/**
 * HermesCN Service Worker
 *
 * Hand-rolled PWA shell worker (no build plugin). Served from /sw.js by the
 * Python backend in prod (api/routes.py serves it explicitly from static/;
 * Task 8.4 will switch that to dist/). Registered only in production builds —
 * see src/main.tsx.
 *
 * Strategy:
 *  - install:  precache the app shell (/, /index.html, /manifest.json, /favicon.svg)
 *  - activate: prune caches from older cache names, then take control
 *  - /api/*:   network-only — API responses are never cached (the UI requires
 *              a live backend)
 *  - navigate: network-first with fallback to the cached shell
 *  - /assets/*: cache-first — Vite emits content-hashed, immutable bundles
 *  - other same-origin GETs: stale-while-revalidate
 */

/* global self, caches, fetch, Response, URL */

// Bump this when the app shell or caching rules change. The legacy worker
// used a server-injected __WEBUI_VERSION__ token; here the cache name is
// static and versioned by hand.
const CACHE_NAME = 'hermescn-v1';

// App shell assets. '/' and '/index.html' are the same document; both are
// listed so the cache can answer navigations and direct /index.html fetches.
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(SHELL_ASSETS).catch((err) => {
        // Non-fatal: activate anyway so navigation fallback still works.
        console.warn('[sw] Shell pre-cache partial failure:', err);
      })
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
        )
      )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Same-origin only; never intercept the worker script itself.
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/sw.js') return;

  // API calls are network-only. The UI requires a live backend, so caching
  // responses would serve stale data and mask auth expiry.
  if (url.pathname.startsWith('/api/')) return;

  if (event.request.method !== 'GET') return;

  // Navigations: network-first with cache fallback to the app shell.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/', clone));
          }
          return response;
        })
        .catch(() =>
          caches.match('/').then((cached) => cached || Response.error())
        )
    );
    return;
  }

  // Hashed bundles under /assets/ are immutable — cache-first.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Everything else same-origin GET (manifest, icons, fonts, ...):
  // stale-while-revalidate.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached || Response.error());
      return cached || network;
    })
  );
});

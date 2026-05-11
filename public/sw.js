/**
 * YData Service Worker - v1.1
 * Specialized for Vite + DuckDB-Wasm + India Connectivity
 */

const CACHE_NAME = 'ydata-enterprise-v1';

// We only cache the core "shell" of the app. 
// Vite's hashed files (e.g. index-ABC123.js) are handled dynamically in the fetch listener.
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  'https://unpkg.com/lucide@latest',
  'https://cdn.plot.ly/plotly-2.27.0.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap'
];

// 1. INSTALL: Warm up the cache
self.addEventListener('install', (event) => {
  console.log('[SW] Installing New Version...');
  self.skipWaiting(); // Force the waiting service worker to become the active one
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CORE_ASSETS);
    })
  );
});

// 2. ACTIVATE: Clean up old versions to save browser space
self.addEventListener('activate', (event) => {
  console.log('[SW] System Active. Cleaning legacy vaults...');
  event.waitUntil(clients.claim()); // Take control of all open tabs immediately
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    })
  );
});

// 3. FETCH: Smart Routing
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // A. BYPASS: Never cache Localhost, Supabase (Database), or Mistral (AI)
  if (
    url.hostname === 'localhost' || 
    url.hostname.includes('supabase.co') || 
    url.hostname.includes('mistral.ai') ||
    request.method !== 'GET'
  ) {
    return; 
  }

  // B. CACHE-FIRST: For heavy, unchanging CDNs (Plotly, Lucide, Fonts)
  if (url.hostname.includes('cdn') || url.hostname.includes('unpkg')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        return cached || fetch(request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        });
      })
    );
    return;
  }

  // C. STALE-WHILE-REVALIDATE: For App Logic and CSS
  // This makes the app load instantly from cache, then updates it in the background.
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(request).then((cached) => {
        const networkFetch = fetch(request).then((response) => {
          // If valid response, update cache
          if (response.ok) {
            cache.put(request, response.clone());
          }
          return response;
        }).catch(() => {
          // Silent catch for offline mode
        });

        return cached || networkFetch;
      });
    })
  );
});

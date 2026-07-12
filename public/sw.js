/* AI-Core Mobile service worker: offline-first app shell.
 * The placeholder tokens below are filled in by scripts/inject-sw-precache.mjs
 * after `vite build`, so a fresh install is fully usable offline immediately.
 * All URLs resolve against the SW scope, so the app works from a sub-path
 * (e.g. GitHub Pages project sites) too.
 */
const CACHE_VERSION = 'ai-core-mobile-__VERSION__'
const PRECACHE_PATHS = __PRECACHE__

const BASE = self.registration.scope

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll([BASE, ...PRECACHE_PATHS.map((p) => BASE + p)]))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Navigations: network first so deploys show up, cached shell offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE_VERSION).then((cache) => cache.put(BASE, copy))
          return response
        })
        .catch(() => caches.match(BASE))
    )
    return
  }

  // Hashed assets: cache first.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy))
        }
        return response
      })
    })
  )
})

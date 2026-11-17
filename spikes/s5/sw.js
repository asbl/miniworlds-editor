// Offline cache for the editor: Pyodide files (jsDelivr), wheels (PyPI file host) and PyPI metadata.
const CACHE = 'mw-editor-s5'
const IMMUTABLE_HOSTS = ['cdn.jsdelivr.net', 'files.pythonhosted.org']
const METADATA_HOSTS = ['pypi.org']

// Test hook: Playwright's offline emulation does not reach Service Worker requests, so simulate it here.
let simulateOffline = false
self.addEventListener('message', (e) => { simulateOffline = e.data === 'offline' })
const net = (request) => (simulateOffline ? Promise.reject(new TypeError('offline (simulated)')) : fetch(request))

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

async function cacheFirst(request) {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(request)
  if (hit) return hit
  const res = await net(request)
  if (res.ok) cache.put(request, res.clone())
  return res
}

// Metadata changes (new releases): try the network briefly, fall back to the last good copy.
async function networkFirst(request, timeoutMs = 3000, ignoreSearch = false) {
  const cache = await caches.open(CACHE)
  try {
    const res = await Promise.race([
      net(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ])
    if (res.ok) cache.put(request, res.clone())
    return res
  } catch (error) {
    const hit = await cache.match(request, { ignoreSearch })
    if (hit) return hit
    throw error
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  const host = url.hostname
  // The app shell itself (same origin) must also start offline; ?query variants share one entry.
  if (url.origin === self.location.origin) event.respondWith(networkFirst(request, 1500, true))
  else if (IMMUTABLE_HOSTS.includes(host)) event.respondWith(cacheFirst(request))
  else if (METADATA_HOSTS.includes(host)) event.respondWith(networkFirst(request))
})

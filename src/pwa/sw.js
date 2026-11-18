/* miniworlds editor: Service Worker. Plain JS, not bundled: scripts/pwaPlugin.ts fills in VERSION and PRECACHE at build time.
 *
 *  app files (index.html, assets, wasm)    precached on install, served cache-first; a new build waits until the user accepts it
 *  Pyodide and wheels (CDN, same origin)   cache-first at runtime (immutable URLs); what was used once also works offline
 *  PyPI metadata, config.json              network-first (short timeout), the last good copy when offline
 */
const VERSION = '__VERSION__'
const PRECACHE = __PRECACHE__
const SHELL_CACHE = `mw-shell-${VERSION}`
const RUNTIME_CACHE = 'mw-runtime-v1'
const IMMUTABLE_HOSTS = ['cdn.jsdelivr.net', 'files.pythonhosted.org']
const METADATA_HOSTS = ['pypi.org']
const scope = new URL(self.registration.scope)
const abs = (path) => new URL(path, scope).href

self.addEventListener('install', (event) => {
  // no skipWaiting here: a running session must not get new code underneath it; the page asks (message 'skip-waiting')
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE.map((p) => new Request(abs(p), { cache: 'reload' })))))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith('mw-shell-') && key !== SHELL_CACHE) await caches.delete(key)
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting()
})

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(request)
  if (hit) return hit
  const res = await fetch(request)
  if (res.ok && res.status === 200) await cache.put(request, res.clone())
  return res
}

async function networkFirst(request, timeoutMs, ignoreSearch) {
  const cache = await caches.open(RUNTIME_CACHE)
  try {
    const res = await Promise.race([fetch(request), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))])
    if (res.ok && res.status === 200) cache.put(request, res.clone())
    return res
  } catch (error) {
    const hit = await cache.match(request, { ignoreSearch })
    if (hit) return hit
    throw error
  }
}

async function shell(request) {
  const cache = await caches.open(SHELL_CACHE)
  const hit = await cache.match(request, { ignoreSearch: true })
  if (hit) return hit
  if (request.mode === 'navigate') {
    const index = await cache.match(abs('index.html'))
    if (index) return index
  }
  return fetch(request)
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET' || request.headers.has('range')) return
  const url = new URL(request.url)
  if (url.origin === scope.origin) {
    if (!url.href.startsWith(scope.href)) return
    const path = url.pathname.slice(scope.pathname.length)
    if (path === 'config.json') event.respondWith(networkFirst(request, 1500, true))
    else if (path.startsWith('pyodide/')) event.respondWith(cacheFirst(request, RUNTIME_CACHE))
    else event.respondWith(shell(request))
  } else if (IMMUTABLE_HOSTS.includes(url.hostname)) event.respondWith(cacheFirst(request, RUNTIME_CACHE))
  else if (METADATA_HOSTS.includes(url.hostname)) event.respondWith(networkFirst(request, 3000, false))
})

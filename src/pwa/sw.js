/* miniworlds editor: Service Worker. Plain JS, not bundled: scripts/pwaPlugin.ts fills in VERSION, PYODIDE and PRECACHE at build time.
 *
 *  app files (index.html, assets, wasm)    precached on install, served cache-first; a new build waits until the user accepts it
 *  Pyodide and wheels (CDN, same origin)   cache-first at runtime (immutable URLs); what was used once also works offline
 *  PyPI metadata, config.json              network-first; the last good copy answers when the network fails or is slow
 */
const VERSION = '__VERSION__'
const PRECACHE = __PRECACHE__
const SHELL_CACHE = `mw-shell-${VERSION}`
// named after Pyodide's version: a new Pyodide starts a fresh cache, the old one is deleted on activate
const RUNTIME_CACHE = 'mw-runtime-__PYODIDE__'
const MAX_WHEELS = 40
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
      for (const key of await caches.keys()) {
        const old = (key.startsWith('mw-shell-') && key !== SHELL_CACHE) || (key.startsWith('mw-runtime-') && key !== RUNTIME_CACHE)
        if (old) await caches.delete(key)
      }
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting()
})

/** Worth keeping: a complete, successful answer that is not an HTML page (error pages, captive portals, SPA fallbacks). */
function cacheable(res) {
  if (!res.ok || res.status !== 200 || res.type === 'opaque') return false
  return !(res.headers.get('content-type') || '').toLowerCase().startsWith('text/html')
}

/** Never throws: a full disk or an evicted cache must not break a request that the network answered. */
async function store(cache, request, res) {
  try {
    await cache.put(request, res)
    // wheels pile up with every version a user tries: keep the newest ones (keys are in insertion order)
    const wheels = (await cache.keys()).filter((r) => new URL(r.url).hostname === 'files.pythonhosted.org')
    for (const old of wheels.slice(0, Math.max(0, wheels.length - MAX_WHEELS))) await cache.delete(old)
  } catch {
    /* quota or cache dropped */
  }
}

async function cacheFirst(event, request) {
  const cache = await caches.open(RUNTIME_CACHE)
  const hit = await cache.match(request)
  if (hit) return hit
  const res = await fetch(request)
  // the page gets the response right away (streaming compile of the WebAssembly); the copy is stored on the side
  if (cacheable(res)) event.waitUntil(store(cache, request, res.clone()))
  return res
}

async function networkFirst(event, request, timeoutMs, ignoreSearch) {
  const cache = await caches.open(RUNTIME_CACHE)
  const cached = await cache.match(request, { ignoreSearch })
  const network = fetch(request).then((res) => {
    if (cacheable(res)) event.waitUntil(store(cache, request, res.clone()))
    return res
  })
  // the copy is stored even when the answer is already given from the cache (a slow network); waitUntil must be called now
  event.waitUntil(network.catch(() => {}))
  // nothing to fall back on: wait for the network however long it takes
  if (!cached) return network
  const slow = new Promise((resolve) => setTimeout(() => resolve(cached), timeoutMs))
  return Promise.race([network.catch(() => cached), slow])
}

async function shell(request) {
  const cache = await caches.open(SHELL_CACHE)
  const hit = await cache.match(request, { ignoreSearch: true })
  if (hit) return hit
  try {
    return await fetch(request)
  } catch (error) {
    // offline: an address of the editor itself still opens the editor (other pages on the same host are not ours to answer)
    if (request.mode === 'navigate') {
      const index = await cache.match(abs('index.html'))
      if (index) return index
    }
    throw error
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET' || request.headers.has('range')) return
  const url = new URL(request.url)
  if (url.origin === scope.origin) {
    if (!url.href.startsWith(scope.href)) return
    const path = url.pathname.slice(scope.pathname.length)
    if (path === 'config.json') event.respondWith(networkFirst(event, request, 1500, true))
    else if (path.startsWith('pyodide/')) event.respondWith(cacheFirst(event, request))
    else event.respondWith(shell(request))
  } else if (IMMUTABLE_HOSTS.includes(url.hostname)) event.respondWith(cacheFirst(event, request))
  else if (METADATA_HOSTS.includes(url.hostname)) event.respondWith(networkFirst(event, request, 3000, false))
})

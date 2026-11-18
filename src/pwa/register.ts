/** Registers the Service Worker (production only) and reports a new version. */
export interface PwaHandle {
  /** `waiting`: a new build is ready; `activated`: another tab already switched, this one still runs the old code. */
  kind: 'waiting' | 'activated'
  /** Switch to the new version and reload; `beforeReload` runs first (save unsaved edits). */
  applyUpdate(beforeReload?: () => Promise<void>): Promise<void>
}

export function registerServiceWorker(onUpdate: (handle: PwaHandle) => void): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  const hadController = navigator.serviceWorker.controller !== null
  let reloading = false
  const reload = () => {
    reloading = true
    location.reload()
  }
  // The new worker deleted the old build's cache. Tabs that did not ask for it keep running old code, and the files they
  // load later (language worker, ruff) may no longer exist: they must be told, not left to break.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return
    onUpdate({ kind: 'activated', applyUpdate: async (before) => (await before?.().catch(() => {}), reload()) })
  })
  void navigator.serviceWorker
    .register(new URL('sw.js', document.baseURI).href)
    .then((registration) => {
      const offer = (worker: ServiceWorker) =>
        onUpdate({
          kind: 'waiting',
          async applyUpdate(before) {
            await before?.().catch(() => {}) // unsaved typing must reach the file system before the page goes away
            navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true })
            worker.postMessage('skip-waiting')
          },
        })
      // a version that finished installing while the page was open, or one that was already waiting at load
      if (registration.waiting && navigator.serviceWorker.controller) offer(registration.waiting)
      registration.addEventListener('updatefound', () => {
        const next = registration.installing
        next?.addEventListener('statechange', () => {
          if (next.state === 'installed' && navigator.serviceWorker.controller) offer(next)
        })
      })
      // long-lived tabs (a classroom keeps them open all day) look for new versions now and then
      setInterval(() => void registration.update().catch(() => {}), 60 * 60 * 1000)
      // the cache can be dropped under storage pressure unless the browser promises to keep it
      void navigator.storage?.persist?.().catch(() => {})
    })
    .catch((error) => console.warn('Service Worker not available', error))
}

/** Registers the Service Worker (production only) and reports a waiting new version. */
export interface PwaHandle {
  /** Activate the waiting version and reload. */
  applyUpdate(): void
}

export function registerServiceWorker(onUpdate: (handle: PwaHandle) => void): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  void navigator.serviceWorker
    .register(new URL('sw.js', document.baseURI).href)
    .then((registration) => {
      const offer = (worker: ServiceWorker) =>
        onUpdate({
          applyUpdate() {
            navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true })
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

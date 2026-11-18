import { useEffect, useState } from 'preact/hooks'

/** The part of the Cache API this needs (a test double stands in for it). */
export interface CacheStorageLike {
  keys(): Promise<string[]>
  open(name: string): Promise<{ keys(): Promise<readonly { url: string }[]> }>
}

const WHEEL = /\/miniworlds-(\d+(?:\.\d+)*)-py3-none-any\.whl$/

/**
 * miniworlds versions whose wheel is in the Service Worker's cache, i.e. that install without network.
 * Asks the cache itself (not a note in localStorage): the cache can be evicted, and a version is only usable offline
 * if the Service Worker really stored it.
 */
export async function cachedVersions(storage: CacheStorageLike | undefined = typeof caches === 'undefined' ? undefined : caches): Promise<string[]> {
  if (!storage) return []
  try {
    const found = new Set<string>()
    for (const name of await storage.keys()) {
      if (!name.startsWith('mw-runtime-')) continue
      for (const request of await (await storage.open(name)).keys()) {
        const version = WHEEL.exec(new URL(request.url).pathname)?.[1]
        if (version) found.add(version)
      }
    }
    return [...found]
  } catch {
    return []
  }
}

/** Cached versions, refreshed when `trigger` changes (a version was installed) or the network state changes. */
export function useCachedVersions(...triggers: unknown[]): string[] {
  const [versions, setVersions] = useState<string[]>([])
  useEffect(() => {
    let live = true
    // the Service Worker stores the wheel a moment after the page received it
    const timer = setTimeout(() => void cachedVersions().then((v) => live && setVersions(v)), 1500)
    return () => {
      live = false
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, triggers)
  return versions
}

import type { KeyValue } from '../project/settings'

const KEY = 'miniworlds-editor.offlineVersions'

/** miniworlds versions that were installed successfully on this device: their wheel is in the Service Worker's cache. */
export function offlineVersions(store: KeyValue): string[] {
  try {
    const raw = JSON.parse(store.get(KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

export function rememberInstalled(store: KeyValue, version: string): void {
  const known = offlineVersions(store)
  if (!known.includes(version)) store.set(KEY, JSON.stringify([...known, version]))
}

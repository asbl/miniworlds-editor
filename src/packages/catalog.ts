import { availableVersions, fetchProject, latestVersion, type EngineTier, type PyPiProject } from './versions'
import type { KeyValue } from '../project/settings'

export interface CatalogEntry {
  version: string
  tier: EngineTier
}
export interface CatalogData {
  /** Newest installable version. */
  latest: string | null
  /** Installable versions, newest first. */
  versions: CatalogEntry[]
  fetchedAt: number
}
export type CatalogStatus = 'idle' | 'loading' | 'ready' | 'offline'

const STORAGE_KEY = 'miniworlds-editor.catalog'

export function toCatalog(project: PyPiProject, now = Date.now()): CatalogData {
  return {
    latest: latestVersion(project)?.version ?? null,
    versions: availableVersions(project).map(({ version, tier }) => ({ version, tier })),
    fetchedAt: now,
  }
}

/**
 * Known miniworlds versions. Starts from the copy stored by the last visit (so the picker works offline)
 * and refreshes from PyPI in the background.
 */
export class Catalog {
  data: CatalogData | null = null
  status: CatalogStatus = 'idle'
  private listeners = new Set<() => void>()
  private inflight: Promise<void> | null = null

  constructor(
    private store: KeyValue,
    private fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {
    this.data = this.restore()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  private update(status: CatalogStatus, data = this.data): void {
    this.status = status
    this.data = data
    this.listeners.forEach((l) => l())
  }

  private restore(): CatalogData | null {
    try {
      const raw = JSON.parse(this.store.get(STORAGE_KEY) ?? 'null') as CatalogData | null
      return raw && Array.isArray(raw.versions) ? raw : null
    } catch {
      return null
    }
  }

  /** Refresh from PyPI. Never throws: offline keeps the stored copy. */
  load(): Promise<void> {
    this.inflight ??= (async () => {
      this.update('loading')
      const project = await fetchProject(this.fetchImpl)
      if (!project) return this.update('offline')
      const data = toCatalog(project)
      if (data.versions.length === 0) return this.update('offline')
      this.store.set(STORAGE_KEY, JSON.stringify(data))
      this.update('ready', data)
    })().finally(() => (this.inflight = null))
    return this.inflight
  }

  tierOf(version: string): EngineTier | null {
    return this.data?.versions.find((v) => v.version === version)?.tier ?? null
  }
}

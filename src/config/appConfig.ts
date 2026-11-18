import { PYODIDE_BASE } from '../runtime/config'

export interface ExternalLink {
  label: string
  url: string
}

/** What a deployment can change without rebuilding: `config.json` next to `index.html`. Every field is optional. */
export interface AppConfig {
  /** Where Pyodide is loaded from (absolute URL ending in "/"); default: jsDelivr, or the build-time VITE_PYODIDE_BASE. */
  pyodideBase: string
  /** Other editors (Java, blocks …) shown in the menu "More editors". */
  links: ExternalLink[]
  /** Pages that may embed the editor and talk to it; null = any page (the embed only ever shows what that page sent). */
  embedOrigins: string[] | null
}

export const DEFAULT_CONFIG: AppConfig = { pyodideBase: PYODIDE_BASE, links: [], embedOrigins: null }

const isHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value)

/** Resolve against the page (a worker would resolve relative to its own script) and make sure it ends with "/". */
export function absoluteBase(base: string, page: string): string {
  const url = new URL(base, page).href
  return url.endsWith('/') ? url : `${url}/`
}

/**
 * Tolerant reader: a damaged or hand-edited file yields the defaults for what is unusable, never an exception.
 * Links must be http(s) (no `javascript:`), embed origins plain origins.
 */
export function parseAppConfig(raw: unknown, page: string): AppConfig {
  const config: AppConfig = { ...DEFAULT_CONFIG, pyodideBase: absoluteBase(DEFAULT_CONFIG.pyodideBase, page) }
  if (typeof raw !== 'object' || raw === null) return config
  const r = raw as Record<string, unknown>
  if (typeof r.pyodideBase === 'string' && r.pyodideBase.trim()) {
    try {
      config.pyodideBase = absoluteBase(r.pyodideBase.trim(), page)
    } catch {
      /* keep the default */
    }
  }
  if (Array.isArray(r.links)) {
    config.links = r.links.flatMap((l): ExternalLink[] => {
      const link = l as Partial<ExternalLink> | null
      if (!link || typeof link.label !== 'string' || typeof link.url !== 'string') return []
      let url: string
      try {
        url = new URL(link.url, page).href
      } catch {
        return []
      }
      return isHttpUrl(url) && link.label.trim() ? [{ label: link.label.trim(), url }] : []
    })
  }
  if (Array.isArray(r.embedOrigins)) {
    const origins = r.embedOrigins.flatMap((o): string[] => {
      if (typeof o !== 'string') return []
      try {
        const u = new URL(o)
        return isHttpUrl(u.href) ? [u.origin] : []
      } catch {
        return []
      }
    })
    config.embedOrigins = origins
  }
  return config
}

/** Fetches `config.json` (cache-busted by the Service Worker's network-first strategy); a missing file means defaults. */
export async function loadAppConfig(page: string = document.baseURI, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<AppConfig> {
  try {
    const res = await fetchImpl(new URL('config.json', page).href, { cache: 'no-cache' })
    if (res.ok) return parseAppConfig(await res.json(), page)
  } catch {
    /* no file, offline or invalid JSON: defaults */
  }
  return parseAppConfig(null, page)
}

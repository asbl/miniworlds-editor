import { PYODIDE_BASE } from '../runtime/config'
import type { LowMemorySetting } from './memory'

export interface ExternalLink {
  label: string
  url: string
}

/** What a deployment can change without rebuilding: `config.json` next to `index.html`. Every field is optional. */
export interface AppConfig {
  /** Where Pyodide is loaded from (absolute URL ending in "/"); default: jsDelivr, or the build-time VITE_PYODIDE_BASE. */
  pyodideBase: string
  /** Legal notice as plain text; operators supply their own in config.json. */
  imprint: string
  /** Legacy configuration accepted for compatibility; no longer displayed in the interface. */
  links: ExternalLink[]
  /**
   * Pages that may embed the editor and talk to it. Embedding is opt-in: without an entry (or with a file that cannot be read
   * or is wrong) nobody may. `["*"]` allows every page; null means exactly that. Python that the embedding page loads runs with
   * the editor's origin, so "every page" is a decision for the operator, not a default.
   */
  embedOrigins: string[] | null
  /** The editor help (second Python, ~130 MB) sleeps while nobody edits: "auto" = on devices with 4 GB or less, true/false forces. */
  lowMemory: LowMemorySetting
  /**
   * Relay for "work together" (address of the WebSocket relay, e.g. "/collab" or "wss://host/collab"); relative to the page.
   * null (the default) switches the feature off: no menu entry. The relay is not part of the editor, see docs/collab.md.
   */
  collabUrl: string | null
  /** Optional classroom storage. null keeps the static editor entirely independent. */
  backendUrl: string | null
}

export const DEFAULT_CONFIG: AppConfig = { pyodideBase: PYODIDE_BASE, imprint: 'Example Operator\nExample Street 1\n12345 Example City\ncontact@example.org', links: [], embedOrigins: [], lowMemory: 'auto', collabUrl: null, backendUrl: null }

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
  if (typeof r.imprint === 'string' && r.imprint.trim()) config.imprint = r.imprint.trim()
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
  if (typeof r.lowMemory === 'boolean') config.lowMemory = r.lowMemory
  if (typeof r.backendUrl === 'string' && r.backendUrl.trim()) {
    try {
      const url = new URL(r.backendUrl.trim(), page)
      if (!url.username && !url.password && !url.search && !url.hash &&
          (url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
        config.backendUrl = url.href.replace(/\/+$/, '')
      }
    } catch { /* invalid addresses disable remote storage */ }
  }
  if (typeof r.collabUrl === 'string' && r.collabUrl.trim()) config.collabUrl = collabAddress(r.collabUrl.trim(), page)
  if ('embedOrigins' in r) {
    // present but unusable (a string, numbers …) stays "nobody": a typo must not open the door
    const list = Array.isArray(r.embedOrigins) ? r.embedOrigins : []
    if (list.includes('*')) config.embedOrigins = null
    else
      config.embedOrigins = list.flatMap((o): string[] => {
        if (typeof o !== 'string') return []
        try {
          const u = new URL(o)
          return isHttpUrl(u.href) ? [u.origin] : []
        } catch {
          return []
        }
      })
  }
  return config
}

/** A relay address as given (relative, http(s) or ws(s)) → an absolute ws(s) address; null for anything else. */
export function collabAddress(value: string, page: string): string | null {
  try {
    const url = new URL(value, page)
    if (url.protocol === 'https:') url.protocol = 'wss:'
    else if (url.protocol === 'http:') url.protocol = 'ws:'
    if (url.protocol !== 'wss:' && url.protocol !== 'ws:') return null
    return url.href.replace(/\/+$/, '')
  } catch {
    return null
  }
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

import { useEffect, useState } from 'preact/hooks'

/** Settings of the person using the editor (not of a project): kept in this browser. */
export interface Preferences {
  /** Which sidebar tab a project opens with. */
  sidebar: 'classes' | 'files'
  /** Advanced tools are hidden unless explicitly enabled. */
  git?: boolean
}

export const DEFAULT_PREFERENCES: Preferences = { sidebar: 'classes' }

const KEY = 'miniworlds-editor.prefs'
const listeners = new Set<() => void>()

export function parsePreferences(text: string | null): Preferences {
  try {
    const raw = text ? (JSON.parse(text) as Partial<Preferences> | null) : null
    return { sidebar: raw?.sidebar === 'files' || raw?.sidebar === 'classes' ? raw.sidebar : DEFAULT_PREFERENCES.sidebar, ...(raw?.git === true ? { git: true } : {}) }
  } catch {
    return DEFAULT_PREFERENCES
  }
}

export function loadPreferences(): Preferences {
  try {
    return parsePreferences(localStorage.getItem(KEY))
  } catch {
    return DEFAULT_PREFERENCES
  }
}

export function savePreferences(next: Preferences): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* kept for this session only */
  }
  memory = next
  listeners.forEach((l) => l())
}

let memory: Preferences | null = null

export function usePreferences(): Preferences {
  const [value, setValue] = useState<Preferences>(() => memory ?? loadPreferences())
  useEffect(() => {
    const update = () => setValue(memory ?? loadPreferences())
    listeners.add(update)
    return () => void listeners.delete(update)
  }, [])
  return value
}

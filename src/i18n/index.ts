import { useEffect, useState } from 'preact/hooks'
import { de } from './de'
import { en } from './en'

export type Lang = 'de' | 'en'
export type MessageKey = keyof typeof de
export const LANGS: readonly Lang[] = ['de', 'en']
export const LANG_NAMES: Record<Lang, string> = { de: 'Deutsch', en: 'English' }

const catalogs: Record<Lang, Record<MessageKey, string>> = { de, en }
const STORAGE_KEY = 'miniworlds-editor.lang'

/** Stored choice wins, then the browser's language list, then German (the main audience). */
export function detectLang(stored: string | null, browserLangs: readonly string[]): Lang {
  if (stored === 'de' || stored === 'en') return stored
  for (const tag of browserLangs) {
    const base = tag.toLowerCase().split('-')[0]
    if (base === 'de' || base === 'en') return base
  }
  return 'de'
}

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

let current: Lang = detectLang(readStored(), typeof navigator === 'undefined' ? [] : (navigator.languages ?? []))
const listeners = new Set<() => void>()

export function getLang(): Lang {
  return current
}

export function setLang(lang: Lang): void {
  current = lang
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    /* private mode etc.: the choice just does not persist */
  }
  if (typeof document !== 'undefined') document.documentElement.lang = lang
  listeners.forEach((l) => l())
}

/** Translate; `{name}` placeholders are filled from `params`. */
export function t(key: MessageKey, params?: Record<string, string | number>, lang: Lang = current): string {
  const text = catalogs[lang][key] ?? catalogs.de[key] ?? key
  return params ? text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m)) : text
}

/** Re-render the calling component when the language changes. */
export function useLang(): Lang {
  const [lang, setLocal] = useState(current)
  useEffect(() => {
    const listener = () => setLocal(current)
    listeners.add(listener)
    listener()
    return () => void listeners.delete(listener)
  }, [])
  return lang
}

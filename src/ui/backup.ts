/**
 * Projects live only in this browser. On a school computer that resets itself that means they can vanish, so the editor offers
 * a backup (ZIP) and, now and then, reminds the pupil. The record says when the pupil last requested a backup or waved the hint away.
 */
const KEY = 'miniworlds-editor.backup'

/** How long a backup request (or "later") keeps the reminder quiet. */
export const REMIND_AFTER_MS = 7 * 24 * 60 * 60 * 1000
/** How long somebody works in a project before the first reminder – long enough to have something worth saving. */
export const FIRST_REMINDER_MS = 4 * 60 * 1000

export function parseBackupRecord(text: string | null): number | null {
  try {
    const raw = text ? (JSON.parse(text) as { at?: unknown } | null) : null
    return typeof raw?.at === 'number' && Number.isFinite(raw.at) ? raw.at : null
  } catch {
    return null
  }
}

/** `last`: time of the last backup request or "later" (null: never). */
export function shouldRemind(last: number | null, now: number): boolean {
  return last === null || now - last >= REMIND_AFTER_MS || last > now
}

export function loadBackupRecord(): number | null {
  try {
    return parseBackupRecord(localStorage.getItem(KEY))
  } catch {
    return null
  }
}

export function saveBackupRecord(now: number): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ at: now }))
  } catch {
    /* the reminder may come again; harmless */
  }
}

/** The browser's storage is nearly full (more than 80 % used, or under 30 MB left): saving may soon fail. */
export function storageLow(estimate: { usage?: number; quota?: number }): boolean {
  const { usage, quota } = estimate
  if (typeof usage !== 'number' || typeof quota !== 'number' || quota <= 0) return false
  return usage / quota > 0.8 || quota - usage < 30 * 1024 * 1024
}

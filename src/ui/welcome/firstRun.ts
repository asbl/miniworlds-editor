/** Remembers, in this browser, that the welcome card has been shown (it appears once, to somebody who never used the editor here). */
const KEY = 'miniworlds-editor.welcomed'

export function hasSeenWelcome(storage: Pick<Storage, 'getItem'> | null = safeStorage()): boolean {
  try {
    return storage?.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function markWelcomeSeen(storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(KEY, '1')
  } catch {
    /* private mode: the card may come again on the next visit, which is harmless */
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

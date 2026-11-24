/** Remembers, in this browser, that somebody closed the card that points to the experiment mode. */
const KEY = 'miniworlds-editor.experimentHintClosed'

export function isExperimentHintClosed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function closeExperimentHint(): void {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    /* the card may come back on the next visit, which is harmless */
  }
}

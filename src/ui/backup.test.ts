import { describe, expect, it } from 'vitest'
import { parseBackupRecord, REMIND_AFTER_MS, shouldRemind } from './backup'

describe('backup reminder', () => {
  it('reads the stored time, and nothing from rubbish', () => {
    expect(parseBackupRecord('{"at":1700000000000}')).toBe(1700000000000)
    expect(parseBackupRecord(null)).toBeNull()
    expect(parseBackupRecord('nonsense')).toBeNull()
    expect(parseBackupRecord('{"at":"yesterday"}')).toBeNull()
  })
  it('reminds when there never was a backup, and again after a week', () => {
    const now = 1_800_000_000_000
    expect(shouldRemind(null, now)).toBe(true)
    expect(shouldRemind(now - 1000, now)).toBe(false)
    expect(shouldRemind(now - REMIND_AFTER_MS, now)).toBe(true)
  })
  it('a time in the future (clock was changed) does not silence the reminder forever', () => {
    expect(shouldRemind(2_000_000_000_000, 1_800_000_000_000)).toBe(true)
  })
})

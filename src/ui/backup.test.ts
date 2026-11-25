import { describe, expect, it } from 'vitest'
import { parseBackupRecord, REMIND_AFTER_MS, shouldRemind, storageLow } from './backup'

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

describe('storageLow', () => {
  it('warns when more than 80 % is used or under 30 MB is left', () => {
    expect(storageLow({ usage: 900, quota: 1000 })).toBe(true)
    expect(storageLow({ usage: 100 * 1024 * 1024, quota: 120 * 1024 * 1024 })).toBe(true)
    expect(storageLow({ usage: 10 * 1024 * 1024, quota: 10 * 1024 * 1024 * 1024 })).toBe(false)
  })

  it('stays quiet when the browser does not say', () => {
    expect(storageLow({})).toBe(false)
    expect(storageLow({ usage: 5, quota: 0 })).toBe(false)
  })
})

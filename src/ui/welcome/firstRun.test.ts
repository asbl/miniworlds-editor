import { describe, expect, it } from 'vitest'
import { hasSeenWelcome, markWelcomeSeen } from './firstRun'

function fakeStorage() {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
}

describe('first run flag', () => {
  it('is unset until the card has been shown', () => {
    const storage = fakeStorage()
    expect(hasSeenWelcome(storage)).toBe(false)
    markWelcomeSeen(storage)
    expect(hasSeenWelcome(storage)).toBe(true)
  })
  it('survives a browser that refuses storage', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    expect(hasSeenWelcome(broken)).toBe(false)
    expect(() => markWelcomeSeen(broken)).not.toThrow()
  })
})

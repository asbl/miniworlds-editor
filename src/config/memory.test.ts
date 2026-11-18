import { describe, expect, it } from 'vitest'
import { isLowMemory } from './memory'

describe('isLowMemory', () => {
  it('decides by the device in auto mode', () => {
    expect(isLowMemory('auto', { deviceMemory: 2 })).toBe(true)
    expect(isLowMemory('auto', { deviceMemory: 4 })).toBe(true)
    expect(isLowMemory('auto', { deviceMemory: 8 })).toBe(false)
    expect(isLowMemory('auto', {})).toBe(false) // Firefox, Safari: no information
  })
  it('can be forced', () => {
    expect(isLowMemory(true, { deviceMemory: 8 })).toBe(true)
    expect(isLowMemory(false, { deviceMemory: 1 })).toBe(false)
  })
})

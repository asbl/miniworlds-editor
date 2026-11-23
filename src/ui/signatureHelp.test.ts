import { describe, expect, it } from 'vitest'
import { visibleParams } from './signatureHelp'

const params = Array.from({ length: 12 }, (_, i) => `p${i}`)

describe('visibleParams', () => {
  it('shows all params when there are few', () => {
    expect(visibleParams(['a', 'b'], 0)).toEqual({ start: 0, end: 2 })
  })
  it('shows a window around the active param', () => {
    expect(visibleParams(params, 8)).toEqual({ start: 5, end: 12 })
    expect(visibleParams(params, 1)).toEqual({ start: 0, end: 7 })
  })
  it('starts at the first param when none is active', () => {
    expect(visibleParams(params, null)).toEqual({ start: 0, end: 7 })
  })
  it('clamps an out-of-range index', () => {
    expect(visibleParams(params, 99)).toEqual({ start: 5, end: 12 })
  })
})

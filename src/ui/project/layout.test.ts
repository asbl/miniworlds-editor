import { describe, expect, it } from 'vitest'
import { clampWidth, effectiveWidths, MIN_EDITOR_WIDTH, parseWidths, widthStyle } from './layout'

describe('clampWidth', () => {
  it('keeps a width inside the limits of the column', () => {
    expect(clampWidth('sidebar', 50, 1600, 440)).toBe(160)
    expect(clampWidth('sidebar', 9000, 3000, 440)).toBe(560)
    expect(clampWidth('world', 500, 1600, 250)).toBe(500)
  })
  it('leaves the editor column its minimum', () => {
    const body = 1000
    expect(clampWidth('world', 900, body, 250)).toBe(body - 250 - MIN_EDITOR_WIDTH)
  })
  it('never goes below the column minimum even on a tiny window', () => {
    expect(clampWidth('world', 600, 500, 250)).toBe(260)
  })
})

describe('parseWidths', () => {
  it('reads stored widths and clamps them', () => {
    expect(parseWidths('{"sidebar":300,"world":5000}')).toEqual({ sidebar: 300, world: 900 })
  })
  it('falls back to the defaults on anything unusable', () => {
    expect(parseWidths(null)).toEqual({ sidebar: null, world: null })
    expect(parseWidths('nonsense')).toEqual({ sidebar: null, world: null })
    expect(parseWidths('{"sidebar":"wide","world":null}')).toEqual({ sidebar: null, world: null })
  })
})

describe('widthStyle', () => {
  it('only mentions the chosen widths', () => {
    expect(widthStyle({ sidebar: null, world: null })).toBe('')
    expect(widthStyle({ sidebar: 300, world: null })).toBe('--sidebar-w:300px')
    expect(widthStyle({ sidebar: 300, world: 500 })).toBe('--sidebar-w:300px;--world-w:500px')
  })
})

describe('effectiveWidths', () => {
  it('leaves widths alone that fit', () => {
    expect(effectiveWidths({ sidebar: 300, world: 500 }, 1600)).toEqual({ sidebar: 300, world: 500 })
    expect(effectiveWidths({ sidebar: null, world: null }, 800)).toEqual({ sidebar: null, world: null })
  })
  it('reduces widths in a small window, without touching the chosen ones', () => {
    const chosen = { sidebar: 560, world: 800 }
    const now = effectiveWidths(chosen, 1000)
    expect((now.sidebar as number) + (now.world as number) + MIN_EDITOR_WIDTH).toBeLessThanOrEqual(1000)
    expect(chosen).toEqual({ sidebar: 560, world: 800 })
    expect(effectiveWidths(chosen, 3000)).toEqual(chosen)
  })
  it('counts a default width of the other column', () => {
    expect(effectiveWidths({ sidebar: 560, world: null }, 1000).sidebar).toBe(240)
  })
  it('ignores an unknown container width', () => {
    expect(effectiveWidths({ sidebar: 300, world: null }, 0)).toEqual({ sidebar: 300, world: null })
  })
})

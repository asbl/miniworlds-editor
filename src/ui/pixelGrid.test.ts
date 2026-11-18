import { describe, expect, it } from 'vitest'
import { PixelGrid } from './pixelGrid'

describe('PixelGrid', () => {
  it('sets, reads and ignores cells outside', () => {
    const g = new PixelGrid(4)
    expect(g.isBlank()).toBe(true)
    expect(g.set(1, 2, '#f00')).toBe(true)
    expect(g.set(1, 2, '#f00')).toBe(false)
    expect(g.get(1, 2)).toBe('#f00')
    expect(g.set(-1, 0, '#f00')).toBe(false)
    expect(g.set(4, 0, '#f00')).toBe(false)
    expect(g.set(1.5, 0, '#f00')).toBe(false)
    expect(g.get(9, 9)).toBeNull()
    expect(g.isBlank()).toBe(false)
  })
  it('draws gap-free lines', () => {
    const g = new PixelGrid(8)
    g.line(0, 0, 7, 3, '#000')
    const dark = g.cells.filter((c) => c).length
    expect(dark).toBeGreaterThanOrEqual(8)
    expect(g.get(0, 0)).toBe('#000')
    expect(g.get(7, 3)).toBe('#000')
    const single = new PixelGrid(4)
    single.line(2, 2, 2, 2, '#000')
    expect(single.get(2, 2)).toBe('#000')
  })
  it('fills the connected area only', () => {
    const g = new PixelGrid(4)
    for (let y = 0; y < 4; y++) g.set(2, y, '#000') // a wall
    expect(g.fill(0, 0, '#0f0')).toBe(true)
    expect(g.get(1, 3)).toBe('#0f0')
    expect(g.get(3, 0)).toBeNull() // behind the wall
    expect(g.fill(0, 0, '#0f0')).toBe(false)
    expect(g.fill(9, 9, '#0f0')).toBe(false)
  })
  it('undoes a whole stroke, and clears', () => {
    const g = new PixelGrid(4)
    g.mark()
    g.line(0, 0, 3, 0, '#000')
    expect(g.undo()).toBe(true)
    expect(g.isBlank()).toBe(true)
    expect(g.undo()).toBe(false)
    g.set(0, 0, '#000')
    g.clear()
    expect(g.isBlank()).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import { qrModules, qrSvg, QR_MAX } from './qr'

describe('qr', () => {
  it('makes a square grid with the three finder patterns', () => {
    const m = qrModules('https://example.org/#play=abc')!
    expect(m.length).toBeGreaterThanOrEqual(21)
    expect(m.every((row) => row.length === m.length)).toBe(true)
    const n = m.length
    for (const [x, y] of [[0, 0], [n - 7, 0], [0, n - 7]] as const) {
      expect(m[y]![x]).toBe(true) // corner of a finder pattern
      expect(m[y + 3]![x + 3]).toBe(true) // its centre
      expect(m[y + 1]![x + 1]).toBe(false) // the light ring
    }
  })
  it('refuses text that is too long for a code a phone can read', () => {
    expect(qrModules('x'.repeat(QR_MAX + 1))).toBeNull()
    expect(qrModules('x'.repeat(QR_MAX))).not.toBeNull()
  })
  it('renders an svg with a quiet zone', () => {
    const m = qrModules('hi')!
    const svg = qrSvg(m)
    expect(svg).toContain(`viewBox="0 0 ${m.length + 8} ${m.length + 8}"`)
    expect(svg.startsWith('<svg')).toBe(true)
  })
})

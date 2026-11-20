import { describe, expect, it } from 'vitest'
import { fitWithin, shrinkableType, shrinkImage, SHRINK_ABOVE } from './shrink'

describe('shrink', () => {
  it('knows which pictures it may touch', () => {
    expect(shrinkableType('images/a.PNG')).toBe('image/png')
    expect(shrinkableType('a.jpg')).toBe('image/jpeg')
    expect(shrinkableType('a.gif')).toBeNull()
    expect(shrinkableType('a.svg')).toBeNull()
    expect(shrinkableType('main.py')).toBeNull()
  })

  it('scales by the longest side and never enlarges', () => {
    expect(fitWithin(4000, 3000, 1280)).toEqual({ width: 1280, height: 960 })
    expect(fitWithin(3000, 4000, 1280)).toEqual({ width: 960, height: 1280 })
    expect(fitWithin(800, 600, 1280)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(5000, 1, 1280)).toEqual({ width: 1280, height: 1 })
  })

  it('leaves small pictures and everything without a canvas alone', async () => {
    expect(await shrinkImage('a.png', new Uint8Array(100))).toBeNull()
    expect(await shrinkImage('a.png', new Uint8Array(SHRINK_ABOVE + 1))).toBeNull() // no OffscreenCanvas in Node
  })
})

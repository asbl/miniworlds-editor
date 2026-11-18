import { describe, expect, it } from 'vitest'
import { anyGuides, directionVector, gridStep, loadGuides, NO_GUIDES, saveGuides } from './guides'

describe('guides', () => {
  it('direction 0 points up, 90 right, 180 down, 270 left', () => {
    const near = (v: [number, number], x: number, y: number) => {
      expect(v[0]).toBeCloseTo(x)
      expect(v[1]).toBeCloseTo(y)
    }
    near(directionVector(0), 0, -1)
    near(directionVector(90), 1, 0)
    near(directionVector(180), 0, 1)
    near(directionVector(270), -1, 0)
  })

  it('grid lines are at least 40 screen pixels apart', () => {
    expect(gridStep(1)).toBe(50)
    expect(gridStep(2)).toBe(20)
    expect(gridStep(0.5)).toBe(100)
    expect(gridStep(0.0001)).toBe(1000)
  })

  it('remembers the choice and survives broken storage', () => {
    const store = new Map<string, string>()
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }
    expect(loadGuides(storage)).toEqual(NO_GUIDES)
    saveGuides({ coords: true, direction: false, boxes: true }, storage)
    expect(loadGuides(storage)).toEqual({ coords: true, direction: false, boxes: true })
    store.set('miniworlds-editor.guides', 'kaputt')
    expect(loadGuides(storage)).toEqual(NO_GUIDES)
    expect(loadGuides({ getItem: () => { throw new Error('blocked') } })).toEqual(NO_GUIDES)
    expect(anyGuides(NO_GUIDES)).toBe(false)
    expect(anyGuides({ ...NO_GUIDES, boxes: true })).toBe(true)
  })
})

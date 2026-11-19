import { describe, expect, it } from 'vitest'
import { describeIgnored, TraceStore } from './traceStore'

const batch = (calls: [string, number, string, string, number][], ignored: [string, string[], number][] = []) => ({ calls, ignored })

describe('TraceStore', () => {
  it('counts calls per method and remembers the time', () => {
    const s = new TraceStore()
    s.add(batch([['classes/Figur.py', 7, 'Figur', 'on_key_down_a', 2]]), 100)
    s.add(batch([['classes/Figur.py', 7, 'Figur', 'on_key_down_a', 3]]), 250)
    expect(s.list()).toHaveLength(1)
    expect(s.list()[0]).toMatchObject({ count: 5, lastAt: 250, line: 7 })
  })

  it('lists by class and puts act last', () => {
    const s = new TraceStore()
    s.add(batch([['a.py', 1, 'Zeta', 'act', 1], ['a.py', 2, 'Zeta', 'on_clicked', 1], ['b.py', 1, 'Alpha', 'act', 1]]), 0)
    expect(s.list().map((r) => `${r.cls}.${r.method}`)).toEqual(['Alpha.act', 'Zeta.on_clicked', 'Zeta.act'])
  })

  it('reports only event methods, not act, as fired classes', () => {
    const s = new TraceStore()
    s.add(batch([['a.py', 1, 'Eins', 'act', 9], ['a.py', 5, 'Zwei', 'on_clicked', 1]]), 1000)
    expect([...s.firedClasses(1200, 450)]).toEqual(['Zwei'])
    expect([...s.firedClasses(1600, 450)]).toEqual([])
  })

  it('returns the touched rows so they can be flashed', () => {
    const s = new TraceStore()
    expect(s.add(batch([['a.py', 1, 'A', 'on_x', 1]]), 0).map((r) => r.method)).toEqual(['on_x'])
  })

  it('keeps ignored inputs apart by what exists', () => {
    const s = new TraceStore()
    s.add(batch([], [['key_down_w', ['on_key_down_a'], 1]]), 0)
    s.add(batch([], [['key_down_w', ['on_key_down_a'], 2]]), 5)
    s.add(batch([], [['key_down_w', [], 1]]), 6)
    expect(s.ignored()).toHaveLength(2)
    expect(s.ignored().find((r) => r.existing.length)?.count).toBe(3)
  })

  it('clear forgets everything', () => {
    const s = new TraceStore()
    s.add(batch([['a.py', 1, 'A', 'on_x', 1]], [['mouse_left_down', [], 1]]), 0)
    s.clear()
    expect(s.size).toBe(0)
    expect(s.ignored()).toEqual([])
  })
})

describe('describeIgnored', () => {
  it('names the key', () => {
    expect(describeIgnored({ event: 'key_down_left', existing: ['on_key_down_a'], count: 1, lastAt: 0 })).toEqual({ kind: 'key', key: 'left', existing: ['on_key_down_a'] })
  })
  it('knows a click', () => {
    expect(describeIgnored({ event: 'mouse_left_down', existing: [], count: 1, lastAt: 0 }).kind).toBe('click')
  })
})

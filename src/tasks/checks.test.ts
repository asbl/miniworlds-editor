import { describe, expect, it } from 'vitest'
import type { ClassModel } from '../uml/model'
import { EMPTY_FACTS, evaluate, hashText, needsMoves, parseCheck, type CheckEnv } from './checks'
import { FactTracker } from './facts'

const model = (): ClassModel => ({
  classes: [
    { name: 'Hai', file: 'classes/Hai.py', line: 1, end_line: 6, bases: ['Actor'], kind: 'actor', methods: [{ name: 'act', line: 3, visibility: '+' }], attributes: [] },
    { name: 'Fisch', file: 'classes/Fisch.py', line: 1, end_line: 4, bases: ['Actor'], kind: 'actor', methods: [], attributes: [] },
  ],
  libraries: [],
  errors: [],
})
const env = (patch: Partial<CheckEnv> = {}): CheckEnv => ({
  facts: EMPTY_FACTS,
  output: '',
  model: model(),
  files: { 'classes/Hai.py': 'class Hai:\n    def act(self):\n        self.add_costume("images/hai.png")\n', 'classes/Fisch.py': 'class Fisch:\n    pass\n' },
  ...patch,
})

describe('FactTracker', () => {
  it('remembers the most actors per class and the highest step', () => {
    const f = new FactTracker()
    expect(f.status({ Wurm: 2, Krabbe: 1 }, 0)).toBe(true)
    expect(f.status({ Wurm: 1, Krabbe: 1 }, 3)).toBe(true)
    expect(f.facts).toMatchObject({ byClass: { Wurm: 1, Krabbe: 1 }, maxByClass: { Wurm: 2, Krabbe: 1 }, maxFrame: 3 })
    expect(f.status({ Wurm: 1, Krabbe: 1 }, 3)).toBe(false)
    expect(f.reset()).toBe(true)
    expect(f.facts).toBe(EMPTY_FACTS)
  })

  it('notices movement only after the first step, from the starting position', () => {
    const f = new FactTracker()
    const at = (x: number, y: number) => [{ handle: 'h1', cls: 'Krabbe', x, y, direction: 0, size: [10, 10] as [number, number] }]
    f.actors(at(10, 10), 0)
    f.actors(at(50, 10), 0) // dragged before the start: the new place is the start
    expect(f.facts.moved).toEqual([])
    f.actors(at(51, 10), 1) // a pixel: not moved
    expect(f.facts.moved).toEqual([])
    expect(f.actors(at(56, 10), 2)).toBe(true)
    expect(f.facts.moved).toEqual(['Krabbe'])
    expect(f.actors(at(70, 10), 3)).toBe(false)
  })

  it('collects selections and calls without duplicates', () => {
    const f = new FactTracker()
    expect(f.selected('Krabbe')).toBe(true)
    expect(f.selected('Krabbe')).toBe(false)
    expect(f.called('fressen')).toBe(true)
    expect(f.called('fressen')).toBe(false)
    expect(f.facts).toMatchObject({ selected: ['Krabbe'], called: ['fressen'] })
  })
})

describe('evaluate', () => {
  const facts = (p: Partial<typeof EMPTY_FACTS>) => ({ ...EMPTY_FACTS, ...p })
  it('actors, gone, fewer', () => {
    const e = env({ facts: facts({ maxByClass: { Wurm: 3 }, byClass: { Wurm: 0 } }) })
    expect(evaluate({ type: 'actors', cls: 'Wurm', min: 3 }, e)).toBe(true)
    expect(evaluate({ type: 'actors', cls: 'Wurm', min: 4 }, e)).toBe(false)
    expect(evaluate({ type: 'gone', cls: 'Wurm' }, e)).toBe(true)
    expect(evaluate({ type: 'gone', cls: 'Hai' }, e)).toBe(false)
    expect(evaluate({ type: 'fewer', cls: 'Wurm' }, e)).toBe(true)
    expect(evaluate({ type: 'fewer', cls: 'Wurm' }, env({ facts: facts({ maxByClass: { Wurm: 3 }, byClass: { Wurm: 3 } }) }))).toBe(false)
  })
  it('moved, selected, called, frames, output', () => {
    const e = env({ facts: facts({ moved: ['A'], selected: ['B'], called: ['fressen'], maxFrame: 30 }), output: 'Hallo Welt' })
    expect(evaluate({ type: 'moved', cls: 'A' }, e)).toBe(true)
    expect(evaluate({ type: 'moved', cls: 'B' }, e)).toBe(false)
    expect(evaluate({ type: 'selected' }, e)).toBe(true)
    expect(evaluate({ type: 'selected', cls: 'A' }, e)).toBe(false)
    expect(evaluate({ type: 'called', method: 'fressen' }, e)).toBe(true)
    expect(evaluate({ type: 'called' }, e)).toBe(true)
    expect(evaluate({ type: 'frames', min: 30 }, e)).toBe(true)
    expect(evaluate({ type: 'frames', min: 31 }, e)).toBe(false)
    expect(evaluate({ type: 'output', contains: 'Welt' }, e)).toBe(true)
  })
  it('class, method, image', () => {
    const e = env()
    expect(evaluate({ type: 'class', name: 'Hai' }, e)).toBe(true)
    expect(evaluate({ type: 'class', name: 'Wal' }, e)).toBe(false)
    expect(evaluate({ type: 'method', cls: 'Hai', name: 'act' }, e)).toBe(true)
    expect(evaluate({ type: 'method', cls: 'Hai', name: 'fressen' }, e)).toBe(false)
    expect(evaluate({ type: 'image', cls: 'Hai' }, e)).toBe(true)
    expect(evaluate({ type: 'image', cls: 'Fisch' }, e)).toBe(false)
    expect(evaluate({ type: 'image', cls: 'Wal' }, e)).toBe(false)
  })
  it('changed compares with the template text', () => {
    const original = 'class Fisch:\n    pass\n'
    expect(evaluate({ type: 'changed', path: 'classes/Fisch.py', hash: hashText(original) }, env())).toBe(false)
    expect(evaluate({ type: 'changed', path: 'classes/Fisch.py', hash: hashText(original + 'x') }, env())).toBe(true)
    expect(evaluate({ type: 'changed', path: 'classes/Weg.py', hash: 'x' }, env())).toBe(false)
  })
  it('all needs every part (and at least one)', () => {
    const e = env({ facts: facts({ maxByClass: { A: 1, B: 1 } }) })
    expect(evaluate({ type: 'all', of: [{ type: 'actors', cls: 'A' }, { type: 'actors', cls: 'B' }] }, e)).toBe(true)
    expect(evaluate({ type: 'all', of: [{ type: 'actors', cls: 'A' }, { type: 'actors', cls: 'C' }] }, e)).toBe(false)
    expect(evaluate({ type: 'all', of: [] }, e)).toBe(false)
  })
})

describe('parseCheck', () => {
  it('accepts complete checks, also nested', () => {
    expect(parseCheck({ type: 'all', of: [{ type: 'actors', cls: 'A', min: 2 }, { type: 'gone', cls: 'B' }] })).toEqual({ type: 'all', of: [{ type: 'actors', cls: 'A', min: 2 }, { type: 'gone', cls: 'B' }] })
    expect(parseCheck({ type: 'called' })).toEqual({ type: 'called' })
  })
  it('rejects the incomplete, the unknown and the endless', () => {
    expect(parseCheck({ type: 'actors' })).toBeNull()
    expect(parseCheck({ type: 'wat' })).toBeNull()
    expect(parseCheck('x')).toBeNull()
    expect(parseCheck(null)).toBeNull()
    expect(parseCheck({ type: 'all', of: [{ type: 'wat' }] })).toBeNull()
    let deep: unknown = { type: 'gone', cls: 'A' }
    for (let i = 0; i < 6; i++) deep = { type: 'all', of: [deep] }
    expect(parseCheck(deep)).toBeNull()
  })
  it('knows which checks need the actors\' positions', () => {
    expect(needsMoves({ type: 'moved', cls: 'A' })).toBe(true)
    expect(needsMoves({ type: 'all', of: [{ type: 'gone', cls: 'A' }, { type: 'moved', cls: 'A' }] })).toBe(true)
    expect(needsMoves({ type: 'gone', cls: 'A' })).toBe(false)
    expect(needsMoves(null)).toBe(false)
  })
})

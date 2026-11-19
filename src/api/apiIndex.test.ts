import { describe, expect, it } from 'vitest'
import { emptyModel } from '../uml/model'
import { chainOf, engineBaseOf, labelOf, membersOf, parseIndex, parseSignature, snippetFor, type ApiIndex } from './apiIndex'

const index: ApiIndex = {
  classes: {
    Actor: { base: null, kind: 'actor', members: [{ name: 'move', kind: 'method', signature: '(distance=1)', doc: 'Move forward.' }, { name: 'x', kind: 'property', doc: 'x position' }, { name: 'turn_left', kind: 'method', signature: '(degrees=90)', doc: 'Turn.' }] },
    Shape: { base: 'Actor', kind: 'actor', members: [{ name: 'fill_color', kind: 'property', doc: 'Fill colour.' }] },
    Circle: { base: 'Shape', kind: 'actor', members: [{ name: 'radius', kind: 'property', doc: 'Radius.' }, { name: 'move', kind: 'method', signature: '(distance=2)', doc: 'Circle move.' }] },
    World: { base: null, kind: 'world', members: [{ name: 'add_background', kind: 'method', signature: '(source)', doc: 'Background.' }] },
  },
}

describe('parseIndex', () => {
  it('reads the engine index', () => expect(parseIndex(JSON.stringify(index))?.classes.Circle?.base).toBe('Shape'))
  it('survives rubbish', () => {
    expect(parseIndex('nope')).toBeNull()
    expect(parseIndex('{}')).toBeNull()
  })
})

describe('chainOf / membersOf', () => {
  it('walks to the root', () => expect(chainOf(index, 'Circle')).toEqual(['Circle', 'Shape', 'Actor']))
  it('is empty for an unknown class', () => expect(chainOf(index, 'Nope')).toEqual([]))
  it('lists own members first and lets a subclass hide an inherited one', () => {
    const rows = membersOf(index, chainOf(index, 'Circle'), '')
    expect(rows.map((r) => `${r.from}.${r.member.name}`)).toEqual(['Circle.radius', 'Circle.move', 'Shape.fill_color', 'Actor.x', 'Actor.turn_left'])
  })
  it('filters by name or doc', () => {
    expect(membersOf(index, ['Actor'], 'TURN').map((r) => r.member.name)).toEqual(['turn_left'])
    expect(membersOf(index, ['Actor'], 'forward').map((r) => r.member.name)).toEqual(['move'])
  })
})

describe('engineBaseOf', () => {
  it('follows the pupil classes down to the engine', () => {
    const model = { ...emptyModel(), classes: [
      { name: 'Wurm', file: 'a.py', line: 1, end_line: 3, bases: ['Tier'], methods: [], attributes: [], kind: 'actor' as const },
      { name: 'Tier', file: 'b.py', line: 1, end_line: 3, bases: ['Circle'], methods: [], attributes: [], kind: 'actor' as const },
    ] }
    expect(engineBaseOf(model, index, 'Wurm')).toBe('Circle')
  })
  it('is null outside a class and for a cycle', () => {
    expect(engineBaseOf(null, index, null)).toBeNull()
    const loop = { ...emptyModel(), classes: [
      { name: 'A', file: 'a.py', line: 1, end_line: 2, bases: ['B'], methods: [], attributes: [], kind: 'actor' as const },
      { name: 'B', file: 'a.py', line: 3, end_line: 4, bases: ['A'], methods: [], attributes: [], kind: 'actor' as const },
    ] }
    expect(engineBaseOf(loop, index, 'A')).toBeNull()
  })
})

describe('signatures and snippets', () => {
  it('finds required parameters, ignoring *args', () => {
    expect(parseSignature('(position, speed=3, *args, **kw)')).toEqual([{ name: 'position', required: true }, { name: 'speed', required: false }])
    expect(parseSignature('()')).toEqual([])
    expect(parseSignature(undefined)).toEqual([])
  })
  it('keeps commas inside default values together', () => {
    expect(parseSignature('(a, b=(1, 2), c=[3, 4])').map((p) => p.name)).toEqual(['a', 'b', 'c'])
  })
  it('makes a field per required parameter', () => {
    expect(snippetFor({ name: 'add_background', kind: 'method', signature: '(source)', doc: '' })).toBe('self.add_background(${1:source})')
    expect(snippetFor({ name: 'move', kind: 'method', signature: '(distance=1)', doc: '' })).toBe('self.move()')
    expect(snippetFor({ name: 'x', kind: 'property', doc: '' })).toBe('self.x')
  })
  it('labels', () => expect(labelOf({ name: 'move', kind: 'method', signature: '(distance=1)', doc: '' })).toBe('move(distance=1)'))
})

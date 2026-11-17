import { describe, expect, it } from 'vitest'
import { layoutModel, buildGraph } from './layout'
import { classAtLine, mergeWithPrevious, signatures, staleClasses, type ClassModel, type ModelClass } from './model'

const cls = (name: string, bases: string[], kind: ModelClass['kind'] = 'actor', extra: Partial<ModelClass> = {}): ModelClass => ({
  name, file: 'main.py', line: 1, end_line: 5, bases, methods: [], attributes: [], kind, ...extra,
})
const model = (classes: ModelClass[], libs: ClassModel['libraries'] = []): ClassModel => ({ classes, libraries: libs, errors: [] })

const LIBS: ClassModel['libraries'] = [
  { name: 'Actor', base: null, kind: 'actor' },
  { name: 'Circle', base: 'Actor', kind: 'actor' },
  { name: 'World', base: null, kind: 'world' },
]

describe('buildGraph', () => {
  it('connects user classes to their library ancestors and sorts worlds first', () => {
    const { roots, nodes } = buildGraph(model([cls('Krabbe', ['Circle']), cls('Spielfeld', ['World'], 'world')], LIBS), true)
    expect(roots.map((r) => r.name)).toEqual(['World', 'Actor'])
    expect(nodes.get('Krabbe')?.parent).toBe('Circle')
    expect(nodes.get('Circle')?.parent).toBe('Actor')
    expect(nodes.get('Actor')?.children.map((c) => c.name)).toEqual(['Circle'])
  })

  it('keeps extra bases as secondary edges and ignores unknown or self bases', () => {
    const { nodes } = buildGraph(model([cls('A', ['Circle']), cls('B', ['A', 'Circle', 'Unknown', 'B'])], LIBS), true)
    expect(nodes.get('B')?.parent).toBe('A')
    expect(nodes.get('B')?.extra).toEqual(['Circle'])
  })

  it('cuts inheritance cycles instead of looping', () => {
    const { nodes, roots } = buildGraph(model([cls('A', ['B']), cls('B', ['A'])]), true)
    expect(nodes.size).toBe(2)
    expect(roots.length).toBeGreaterThanOrEqual(1)
  })

  it('the first of two classes with the same name wins', () => {
    const { nodes } = buildGraph(model([cls('A', [], 'actor', { line: 1 }), cls('A', [], 'actor', { line: 99 })]), true)
    expect((nodes.get('A')?.info as ModelClass).line).toBe(1)
  })
})

describe('layoutModel', () => {
  const big = model(
    [cls('Krabbe', ['Circle'], 'actor', { methods: [{ name: 'act', line: 3, visibility: '+', params: [], kind: 'event' }], attributes: [{ name: 'gefressen', line: 2, visibility: '+' }] }), cls('Wurm', ['Circle']), cls('Hai', ['Krabbe']), cls('Spielfeld', ['World'], 'world')],
    LIBS,
  )

  it('places children below their parent and never overlaps boxes', () => {
    const { nodes } = layoutModel(big)
    const by = Object.fromEntries(nodes.map((n) => [n.name, n]))
    expect(by.Krabbe!.y).toBeGreaterThan(by.Circle!.y + by.Circle!.h - 1)
    expect(by.Hai!.y).toBeGreaterThan(by.Krabbe!.y)
    for (const a of nodes) {
      for (const b of nodes) {
        if (a === b) continue
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
        expect(overlap, `${a.name} / ${b.name}`).toBe(false)
      }
    }
  })

  it('has one edge per inheritance link and sizes the canvas to the content', () => {
    const l = layoutModel(big)
    // Krabbe→Circle, Wurm→Circle, Hai→Krabbe, Spielfeld→World, Circle→Actor (roots have no edge)
    expect(l.edges).toHaveLength(5)
    for (const n of l.nodes) {
      expect(n.x + n.w).toBeLessThanOrEqual(l.width)
      expect(n.y + n.h).toBeLessThanOrEqual(l.height)
    }
  })

  it('details off makes boxes smaller; long member lists are cut with a counter', () => {
    const many = model([cls('A', ['Circle'], 'actor', { methods: Array.from({ length: 9 }, (_, i) => ({ name: `m${i}`, line: i, visibility: '+' as const, params: [] })) })], LIBS)
    const withDetails = layoutModel(many, true).nodes.find((n) => n.name === 'A')!
    const without = layoutModel(many, false).nodes.find((n) => n.name === 'A')!
    expect(withDetails.methods).toHaveLength(6)
    expect(withDetails.hiddenMethods).toBe(3)
    expect(without.h).toBeLessThan(withDetails.h)
    expect(without.methods).toHaveLength(0)
  })

  it('an empty model is an empty layout', () => {
    expect(layoutModel({ classes: [], libraries: [], errors: [] })).toEqual({ nodes: [], edges: [], width: 0, height: 0 })
  })
})

describe('model helpers', () => {
  const files = { 'main.py': 'a\nclass A:\n    x = 1\nb\n' }
  const m = model([cls('A', [], 'other', { line: 2, end_line: 3 })])

  it('detects changed classes against the loaded signatures', () => {
    const loaded = signatures(m, files)
    expect(staleClasses(m, files, loaded).size).toBe(0)
    expect(staleClasses(m, { 'main.py': 'a\nclass A:\n    x = 2\nb\n' }, loaded)).toEqual(new Set(['A']))
    expect(staleClasses(m, files, null).size).toBe(0)
  })

  it('finds the class around a line', () => {
    expect(classAtLine(m, 'main.py', 3)).toBe('A')
    expect(classAtLine(m, 'main.py', 4)).toBeNull()
    expect(classAtLine(m, 'other.py', 3)).toBeNull()
  })

  it('keeps the old classes of a file that has a syntax error right now', () => {
    const before = model([cls('A', []), cls('B', [], 'actor', { file: 'b.py' })])
    const now: ClassModel = { classes: [cls('A', [])], libraries: [], errors: [{ file: 'b.py', line: 3, message: 'invalid syntax' }] }
    const merged = mergeWithPrevious(before, now)
    expect(merged.classes.map((c) => c.name).sort()).toEqual(['A', 'B'])
    expect(merged.errors).toHaveLength(1)
    expect(mergeWithPrevious(before, model([cls('A', [])])).classes).toHaveLength(1)
  })
})

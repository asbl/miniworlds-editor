import { describe, expect, it } from 'vitest'
import blocks from './blocks.json'
import { GROUPS, importChange, methodAnchor, statementAnchor, type Block } from './insert'

const apply = (doc: string, a: { from: number; to: number; insert: string }, text: string) => doc.slice(0, a.from) + a.insert + text + doc.slice(a.to)

describe('statementAnchor', () => {
  const code = 'class A:\n    def act(self):\n        self.move(2)\n\n    def other(self):\n        pass\n'
  it('puts a block on a blank line, indented like the code above', () => {
    const cursor = code.indexOf('self.move(2)\n') + 'self.move(2)\n'.length // the empty line after move
    const a = statementAnchor(code, cursor)
    expect(apply(code, a, 'X')).toContain('        self.move(2)\n        X\n')
  })
  it('puts a block below a line with code, one level deeper after a colon', () => {
    const afterDef = code.indexOf('def act(self):') + 3
    expect(apply(code, statementAnchor(code, afterDef), 'X')).toContain('def act(self):\n        X\n        self.move(2)')
    const inBody = code.indexOf('self.move') + 2
    expect(apply(code, statementAnchor(code, inBody), 'X')).toContain('self.move(2)\n        X\n')
  })
  it('keeps the indentation of an indented blank line', () => {
    const doc = 'def a():\n    x = 1\n    \n    y = 2'
    const a = statementAnchor(doc, doc.indexOf('    \n') + 4)
    expect(apply(doc, a, 'X')).toBe('def a():\n    x = 1\n    X\n    y = 2')
  })
  it('works in an empty file and at the very end', () => {
    expect(apply('', statementAnchor('', 0), 'X')).toBe('X')
    expect(apply('a = 1', statementAnchor('a = 1', 5), 'X')).toBe('a = 1\nX')
  })
})

describe('methodAnchor', () => {
  const doc = 'import miniworlds as mw\n\n\nclass A(mw.Circle):\n    def act(self):\n        self.move(2)\n\n\nclass B(mw.Circle):\n    pass\n'
  it('goes to the end of the class the cursor is in', () => {
    const a = methodAnchor(doc, doc.indexOf('self.move'))!
    expect(apply(doc, a, 'def x(self):').split('\n').slice(3, 9)).toEqual(['class A(mw.Circle):', '    def act(self):', '        self.move(2)', '', '    def x(self):', ''])
    const b = methodAnchor(doc, doc.indexOf('pass'))!
    expect(apply(doc, b, 'def y(self):')).toMatch(/class B\(mw\.Circle\):\n    pass\n\n    def y\(self\):\n?$/)
  })
  it('says no when the cursor is outside any class', () => {
    expect(methodAnchor(doc, 3)).toBeNull()
    expect(methodAnchor('a = 1\nb = 2', 8)).toBeNull()
  })
  it('does not take a class that ended above a top-level statement', () => {
    const d = 'class A:\n    pass\n\nx = 1\n'
    expect(methodAnchor(d, d.indexOf('x = 1'))).toBeNull()
  })
})

describe('importChange', () => {
  it('adds a missing import after the existing ones', () => {
    const doc = 'import miniworlds as mw\nfrom classes.A import A\n\nx = 1\n'
    const c = importChange(doc, ['random'])!
    expect(doc.slice(0, c.from) + c.insert + doc.slice(c.from)).toBe('import miniworlds as mw\nfrom classes.A import A\nimport random\n\nx = 1\n')
  })
  it('adds it at the top of a file without imports, and not twice', () => {
    expect(importChange('x = 1\n', ['random'])).toEqual({ from: 0, insert: 'import random\n' })
    expect(importChange('import random\nx = 1\n', ['random'])).toBeNull()
    expect(importChange('from random import randint\n', ['random'])).toBeNull()
    expect(importChange('x = 1', undefined)).toBeNull()
  })
})

describe('blocks.json', () => {
  const all = blocks as Block[]
  it('every block has a known group and unique id, method blocks start with def', () => {
    expect(new Set(all.map((b) => b.id)).size).toBe(all.length)
    for (const b of all) {
      expect(GROUPS).toContain(b.group)
      if (b.kind === 'method') expect(b.code.startsWith('def ')).toBe(true)
      else expect(b.code.startsWith('def ')).toBe(false)
    }
  })
})

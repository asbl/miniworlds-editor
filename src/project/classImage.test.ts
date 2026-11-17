import { describe, expect, it } from 'vitest'
import { classImagePath, fitSize, setClassImage } from './classImage'

const span = (source: string, name = 'Krabbe') => {
  const lines = source.split('\n')
  const line = lines.findIndex((l) => l.startsWith(`class ${name}`)) + 1
  const methods = lines.flatMap((l, i) => {
    const m = /^\s+def (\w+)/.exec(l)
    return m ? [{ name: m[1] as string, line: i + 1, visibility: '+' as const }] : []
  })
  let end = line // last line of the class body: indented (or blank between indented lines)
  for (let i = line; i < lines.length && /^\s+\S/.test(lines[i] as string) || (lines[i] ?? '').trim() === '' && /^\s+\S/.test(lines[i + 1] ?? ''); i++) end = i + 1
  return { line, end_line: end, methods }
}

describe('classImagePath', () => {
  it('finds a quoted image path', () => {
    expect(classImagePath('self.add_costume("images/krabbe.png")')).toBe('images/krabbe.png')
    expect(classImagePath("x = 'a b/c.JPG'")).toBe('a b/c.JPG')
    expect(classImagePath('self.fill_color = (1, 2, 3)')).toBeNull()
  })
})

describe('fitSize', () => {
  it('shrinks large images to 80px and keeps small ones', () => {
    expect(fitSize(400, 200)).toEqual([80, 40])
    expect(fitSize(40, 20)).toEqual([40, 20])
  })
})

describe('setClassImage', () => {
  it('inserts into an existing on_setup', () => {
    const src = 'class Krabbe(mw.Actor):\n    def on_setup(self):\n        self.speed = 2\n'
    const r = setClassImage(src, span(src), 'images/k.png', [80, 40])
    expect(r).toEqual({ ok: true, text: 'class Krabbe(mw.Actor):\n    def on_setup(self):\n        self.add_costume("images/k.png")\n        self.size = (80, 40)\n        self.speed = 2\n' })
  })

  it('creates on_setup at the end of the class when there is none', () => {
    const src = 'class Krabbe(mw.Actor):\n    def act(self):\n        self.move(1)\n\nwelt = 1\n'
    const r = setClassImage(src, span(src), 'images/k.png', null)
    expect(r.ok && r.text).toBe('class Krabbe(mw.Actor):\n    def act(self):\n        self.move(1)\n\n    def on_setup(self):\n        self.add_costume("images/k.png")\n\nwelt = 1\n')
  })

  it('replaces an existing costume and its size line', () => {
    const src = 'class Krabbe(mw.Actor):\n    def on_setup(self):\n        self.add_costume("images/old.png")\n        self.size = (10, 10)\n        self.x = 1\n'
    const r = setClassImage(src, span(src), 'images/new.png', [64, 64])
    expect(r.ok && r.text).toBe('class Krabbe(mw.Actor):\n    def on_setup(self):\n        self.add_costume("images/new.png")\n        self.size = (64, 64)\n        self.x = 1\n')
  })

  it('adds a size line after a replaced costume that had none', () => {
    const src = 'class Krabbe(mw.Actor):\n    def on_setup(self):\n        self.add_costume("images/old.png")\n'
    const r = setClassImage(src, span(src), 'images/new.png', [32, 32])
    expect(r.ok && r.text).toBe('class Krabbe(mw.Actor):\n    def on_setup(self):\n        self.add_costume("images/new.png")\n        self.size = (32, 32)\n')
  })

  it('keeps an existing size line when the new image has no known size', () => {
    const src = 'class Krabbe(mw.Actor):\n    def on_setup(self):\n        self.add_costume("images/old.png")\n        self.size = (10, 10)\n'
    const r = setClassImage(src, span(src), 'images/new.png', null)
    expect(r.ok && r.text).toBe('class Krabbe(mw.Actor):\n    def on_setup(self):\n        self.add_costume("images/new.png")\n        self.size = (10, 10)\n')
  })

  it('does not touch another class with a costume of its own', () => {
    const src = 'class Hai(mw.Actor):\n    def on_setup(self):\n        self.add_costume("images/hai.png")\n\n\nclass Krabbe(mw.Actor):\n    def act(self):\n        pass\n'
    const r = setClassImage(src, span(src, 'Krabbe'), 'images/k.png', null)
    expect(r.ok && r.text).toContain('self.add_costume("images/hai.png")')
    expect(r.ok && r.text).toContain('images/k.png')
  })

  it('refuses a one-line on_setup instead of guessing', () => {
    const src = 'class Krabbe(mw.Actor):\n    def on_setup(self): pass\n'
    expect(setClassImage(src, span(src), 'images/k.png', null)).toEqual({ ok: false, reason: 'one-line-setup' })
  })

  it('works for a tab-free nested indent and a typed signature', () => {
    const src = 'class Krabbe(mw.Actor):\n    def on_setup(self) -> None:\n        pass\n'
    const r = setClassImage(src, span(src), 'images/k.png', null)
    expect(r.ok && r.text).toBe('class Krabbe(mw.Actor):\n    def on_setup(self) -> None:\n        self.add_costume("images/k.png")\n        pass\n')
  })
})

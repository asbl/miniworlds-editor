import { describe, expect, it } from 'vitest'
import { enginePrefix, messageHandlerLines, readToolbar, setToolbar, toolbarLines, validName, type ToolbarSpec } from './classToolbar'

const spec: ToolbarSpec = {
  dock: 'right',
  widgets: [
    { kind: 'button', text: 'Start' },
    { kind: 'label', text: 'Hallo "du"' },
    { kind: 'counter', text: 'Punkte', name: 'punkte' },
  ],
}

// the same text runs against the real engine in test/py/test_toolbar.py (keep both in step)
export const SAMPLE = `# Bedienfeld {"dock":"right","widgets":[{"kind":"button","text":"Start"},{"kind":"label","text":"Hallo \\"du\\""},{"kind":"counter","text":"Punkte","name":"punkte"}]}
toolbar = mw.Toolbar()
toolbar.add(mw.Button("Start"))
toolbar.add(mw.Label("Hallo \\"du\\""))
self.punkte = mw.CounterLabel("Punkte", 0)
toolbar.add(self.punkte)
self.camera.add_right(toolbar)
# Ende Bedienfeld`

const CLASS = `import miniworlds as mw


class Spiel(mw.World):
    def on_setup(self):
        self.add_background((226, 238, 214))
`
const cls = (start: number, end: number, methods: string[] = ['on_setup'], setupLine = 5) => ({ line: start, end_line: end, methods: methods.map((name) => ({ name, line: name === 'on_setup' ? setupLine : end, visibility: '+' as const })) })

describe('toolbarLines', () => {
  it('writes the panel', () => expect(toolbarLines(spec, 'mw.').join('\n')).toBe(SAMPLE))
  it('works without a prefix', () => expect(toolbarLines({ dock: 'bottom', widgets: [{ kind: 'button', text: 'X' }] }, '')).toContain('toolbar = Toolbar()'))
})

describe('readToolbar', () => {
  it('reads what was written', () => expect(readToolbar(SAMPLE)).toEqual(spec))
  it('is null when there is none or the data is damaged', () => {
    expect(readToolbar(CLASS)).toBeNull()
    expect(readToolbar('# Bedienfeld {"dock":"top","widgets":[]}')).toBeNull()
    expect(readToolbar('# Bedienfeld {nope')).toBeNull()
  })
})

describe('setToolbar', () => {
  it('adds the panel at the end of on_setup', () => {
    const r = setToolbar(CLASS, cls(4, 6), spec, false)
    expect(r.ok && r.text).toContain('        self.add_background((226, 238, 214))\n        # Bedienfeld {')
    expect(r.ok && r.text).toContain('        # Ende Bedienfeld')
  })

  it('replaces an earlier panel instead of adding a second', () => {
    const first = setToolbar(CLASS, cls(4, 6), spec, false) as { ok: true; text: string }
    const lines = first.text.split('\n').length
    const second = setToolbar(first.text, cls(4, lines), { dock: 'left', widgets: [{ kind: 'label', text: 'Nur Text' }] }, false)
    expect(second.ok && second.text.match(/# Bedienfeld/g)?.length).toBe(1)
    expect(second.ok && second.text).toContain('self.camera.add_left(toolbar)')
    expect(second.ok && second.text).not.toContain('Start')
  })

  it('creates on_setup when the class has none', () => {
    const source = 'import miniworlds as mw\n\n\nclass Spiel(mw.World):\n    pass\n'
    const r = setToolbar(source, cls(4, 5, []), spec, false)
    expect(r.ok && r.text).toContain('class Spiel(mw.World):\n    pass\n\n    def on_setup(self):\n        # Bedienfeld')
  })

  it('adds the engine import when the file has none', () => {
    const source = 'class Spiel:\n    def on_setup(self):\n        pass\n'
    const r = setToolbar(source, { line: 1, end_line: 3, methods: [{ name: 'on_setup', line: 2, visibility: '+' }] }, spec, false)
    expect(r.ok && r.text.startsWith('import miniworlds as mw\nclass Spiel:')).toBe(true)
    expect(r.ok && r.text).toContain('toolbar = mw.Toolbar()')
  })

  it('refuses a one-line on_setup', () => {
    const source = 'import miniworlds as mw\n\n\nclass Spiel(mw.World):\n    def on_setup(self): pass\n'
    expect(setToolbar(source, cls(4, 5), spec, false)).toEqual({ ok: false, reason: 'one-line-setup' })
  })

  it('adds on_message for the buttons, once', () => {
    const r = setToolbar(CLASS, cls(4, 6), spec, true)
    expect(r.ok && r.handlerAdded).toBe(true)
    expect(r.ok && r.text).toContain('    def on_message(self, message):\n        if message == "Start":\n            pass')
    const again = setToolbar(CLASS, cls(4, 6, ['on_setup', 'on_message']), spec, true)
    expect(again.ok && again.handlerAdded).toBe(false)
  })

  it('writes no handler without buttons', () => {
    expect(messageHandlerLines({ dock: 'right', widgets: [{ kind: 'label', text: 'x' }] })).toEqual([])
  })
})

describe('helpers', () => {
  it('finds how the file spells the engine', () => {
    expect(enginePrefix('import miniworlds as mw')).toBe('mw.')
    expect(enginePrefix('import miniworlds as m2')).toBe('m2.')
    expect(enginePrefix('from miniworlds import *')).toBe('')
    expect(enginePrefix('import miniworlds')).toBe('miniworlds.')
    expect(enginePrefix('x = 1')).toBeNull()
  })
  it('checks names', () => {
    expect(validName('punkte')).toBe(true)
    expect(validName('2x')).toBe(false)
    expect(validName('a b')).toBe(false)
  })
})

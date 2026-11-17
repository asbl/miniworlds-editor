import { describe, expect, it } from 'vitest'
import { MemoryFs } from '../workspace'
import { createProject } from '../project/create'
import { cleanRequirements, loadSettings, saveSettings, type KeyValue } from '../project/settings'
import { toPygameButton, toPygameKey, toPygameMod, toUnicode } from './keymap'
import { errorLocation, linkify } from './traceback'

const TB = `Traceback (most recent call last):
  File "/project/main.py", line 4, in <module>
    welt = Spielfeld(400, 300)
  File "/project/classes/Spielfeld.py", line 7, in __init__
    self.foo()
  File "/lib/python3.13/site-packages/miniworlds/x.py", line 10, in foo
AttributeError: no foo`

describe('traceback', () => {
  it('links only frames inside the project', () => {
    const lines = linkify(TB)
    const links = lines.flat().filter((s) => s.link)
    expect(links.map((s) => s.link)).toEqual([
      { path: 'main.py', line: 4 },
      { path: 'classes/Spielfeld.py', line: 7 },
    ])
    expect(lines[0]).toEqual([{ text: 'Traceback (most recent call last):' }])
    expect(lines[1]?.[0]).toEqual({ text: '  ' })
    expect(lines.flat().map((s) => s.text).join('')).toBe(TB.replace(/\n/g, ''))
  })
  it('finds the innermost project frame', () => {
    expect(errorLocation(TB)).toEqual({ path: 'classes/Spielfeld.py', line: 7 })
    expect(errorLocation('nothing here')).toBeNull()
    expect(errorLocation('File "/lib/x.py", line 3')).toBeNull()
  })
  it('handles syntax error output', () => {
    expect(errorLocation('  File "/project/classes/A.py", line 2\n    x =\n      ^\nSyntaxError: invalid syntax')).toEqual({ path: 'classes/A.py', line: 2 })
  })
})

describe('keymap', () => {
  it('maps printable keys case-insensitively to ASCII', () => {
    expect(toPygameKey({ key: 'a', code: 'KeyA' })).toBe(97)
    expect(toPygameKey({ key: 'A', code: 'KeyA' })).toBe(97)
    expect(toPygameKey({ key: '5', code: 'Digit5' })).toBe(53)
    expect(toPygameKey({ key: ' ', code: 'Space' })).toBe(32)
  })
  it('maps arrows, function keys and modifiers to SDL codes', () => {
    expect(toPygameKey({ key: 'ArrowUp', code: 'ArrowUp' })).toBe(1073741906)
    expect(toPygameKey({ key: 'ArrowLeft', code: 'ArrowLeft' })).toBe(1073741904)
    expect(toPygameKey({ key: 'F1', code: 'F1' })).toBe(1073741882)
    expect(toPygameKey({ key: 'Shift', code: 'ShiftLeft' })).toBe(1073742049)
    expect(toPygameKey({ key: 'Enter', code: 'Enter' })).toBe(13)
  })
  it('ignores keys pygame does not know', () => {
    expect(toPygameKey({ key: 'Dead', code: 'Quote' })).toBeNull()
    expect(toPygameKey({ key: 'ü', code: 'BracketLeft' })).toBeNull()
    expect(toPygameKey({ key: 'F13', code: 'F13' })).toBeNull()
  })
  it('builds modifier masks, unicode and buttons', () => {
    expect(toPygameMod({ key: 'a', code: 'KeyA', shiftKey: true, ctrlKey: true })).toBe(65)
    expect(toUnicode({ key: 'a' })).toBe('a')
    expect(toUnicode({ key: 'ArrowUp' })).toBe('')
    expect([0, 1, 2].map(toPygameButton)).toEqual([1, 2, 3])
  })
})

describe('project settings', () => {
  const store = (): KeyValue => {
    const m = new Map<string, string>()
    return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) }
  }
  const spec = { kind: 'project', name: 'Demo', miniworlds: null, worldName: 'W', actorName: 'A', worldVar: 'w', actorVar: 'a' } as const

  it('round-trips through project.toml and keeps name and entry', async () => {
    const fs = new MemoryFs()
    await createProject(fs, spec)
    await saveSettings(fs, 'project', 'Demo', store(), { miniworlds: '4.4.0.16', packages: ['requests'] })
    expect(await loadSettings(fs, 'project', 'Demo', store())).toEqual({ miniworlds: '4.4.0.16', packages: ['requests'] })
    expect(await fs.read('project.toml')).toContain('name = "Demo"')
  })
  it('keeps single-file projects free of project.toml', async () => {
    const fs = new MemoryFs()
    await createProject(fs, { ...spec, kind: 'legacy' })
    const kv = store()
    await saveSettings(fs, 'legacy', 'Alt', kv, { miniworlds: '4.3.0.1', packages: [] })
    expect(await fs.exists('project.toml')).toBe(false)
    expect(await loadSettings(fs, 'legacy', 'Alt', kv)).toEqual({ miniworlds: '4.3.0.1', packages: [] })
    expect(await loadSettings(fs, 'legacy', 'Other', kv)).toEqual({ miniworlds: null, packages: [] })
  })
  it('survives a broken project.toml and corrupt stored JSON', async () => {
    const fs = new MemoryFs()
    await fs.write('project.toml', 'this is = = not toml')
    expect(await loadSettings(fs, 'project', 'X', store())).toEqual({ miniworlds: null, packages: [] })
    const kv = store()
    kv.set('miniworlds-editor.settings.X', '{nope')
    expect(await loadSettings(fs, 'legacy', 'X', kv)).toEqual({ miniworlds: null, packages: [] })
    await saveSettings(fs, 'project', 'X', store(), { miniworlds: null, packages: [] }) // rewrites broken file
    expect(await fs.read('project.toml')).toContain('name = "X"')
  })
  it('cleans requirement lists', () => {
    expect(cleanRequirements([' requests ', '', 'requests', 'six==1.16'])).toEqual(['requests', 'six==1.16'])
  })
})

import { canvasPoint } from './input'

describe('canvasPoint', () => {
  const size = { width: 400, height: 300 }
  it('maps client coordinates to bitmap pixels when the canvas is scaled', () => {
    expect(canvasPoint({ clientX: 110, clientY: 60 }, { left: 10, top: 10, width: 200, height: 150 }, size)).toEqual({ x: 200, y: 100 })
  })
  it('clamps to the bitmap and survives a zero-sized rect', () => {
    expect(canvasPoint({ clientX: -5, clientY: 999 }, { left: 0, top: 0, width: 400, height: 300 }, size)).toEqual({ x: 0, y: 299 })
    expect(canvasPoint({ clientX: 5, clientY: 5 }, { left: 0, top: 0, width: 0, height: 0 }, size)).toEqual({ x: 5, y: 5 })
  })
})

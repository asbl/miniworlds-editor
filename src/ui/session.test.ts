import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryFs } from '../workspace'
import { Session, type Surface } from './session'

function fakeSurface() {
  const calls: string[] = []
  const surface: Surface = {
    show: (p, t) => calls.push(`show ${p}:${t}`),
    clear: () => calls.push('clear'),
    forget: (p) => calls.push(`forget ${p}`),
    reveal: (l, c, n) => calls.push(`reveal ${l}:${c}+${n}`),
  }
  return { surface, calls }
}

describe('Session', () => {
  let fs: MemoryFs
  let calls: string[]
  let session: Session
  beforeEach(async () => {
    vi.useFakeTimers()
    fs = new MemoryFs()
    await fs.write('a.py', 'A')
    await fs.write('b.py', 'B')
    const f = fakeSurface()
    calls = f.calls
    session = new Session(fs, f.surface, 500)
  })
  afterEach(() => vi.useRealTimers())

  it('opens tabs once and shows the active file', async () => {
    await session.open('a.py')
    await session.open('b.py')
    await session.open('a.py')
    expect(session.state.open).toEqual(['a.py', 'b.py'])
    expect(session.state.active).toBe('a.py')
    expect(calls).toContain('show b.py:B')
  })

  it('autosaves after the delay and clears the dirty flag', async () => {
    await session.open('a.py')
    session.edit('a.py', 'A2')
    expect(session.state.dirty.has('a.py')).toBe(true)
    expect(await fs.read('a.py')).toBe('A')
    await vi.advanceTimersByTimeAsync(600)
    expect(await fs.read('a.py')).toBe('A2')
    expect(session.state.dirty.size).toBe(0)
  })

  it('shows unsaved edits when switching tabs back and forth', async () => {
    await session.open('a.py')
    session.edit('a.py', 'A2')
    await session.open('b.py')
    await session.show('a.py')
    expect(calls.at(-1)).toBe('show a.py:A2')
  })

  it('saves pending edits when a tab is closed and activates a neighbour', async () => {
    await session.open('a.py')
    await session.open('b.py')
    session.edit('b.py', 'B2')
    await session.close('b.py')
    expect(await fs.read('b.py')).toBe('B2')
    expect(session.state.active).toBe('a.py')
    await session.close('a.py')
    expect(session.state.active).toBeNull()
    expect(calls.at(-1)).toBe('clear')
  })

  it('keeps the file dirty when an edit arrives while saving', async () => {
    await session.open('a.py')
    session.edit('a.py', 'A2')
    const saving = session.save('a.py')
    session.edit('a.py', 'A3')
    await saving
    expect(session.state.dirty.has('a.py')).toBe(true)
    await vi.advanceTimersByTimeAsync(600)
    expect(await fs.read('a.py')).toBe('A3')
  })

  it('does not open binary files in the text editor', async () => {
    await fs.write('images/x.png', new Uint8Array([1]))
    await session.open('a.py')
    await session.open('images/x.png')
    expect(session.state.active).toBe('images/x.png')
    expect(calls.at(-1)).toBe('clear')
  })

  it('reveals a search hit', async () => {
    await session.open('a.py', { line: 3, column: 2, length: 4 })
    expect(calls.at(-1)).toBe('reveal 3:2+4')
  })

  it('writeText replaces pending edits and refreshes the editor', async () => {
    await session.open('a.py')
    session.edit('a.py', 'typed')
    await session.writeText('a.py', 'generated')
    expect(await fs.read('a.py')).toBe('generated')
    expect(session.state.dirty.size).toBe(0)
    expect(calls.at(-1)).toBe('show a.py:generated')
  })

  it('removed closes tabs below a folder and drops their edits', async () => {
    await fs.write('d/x.py', 'X')
    await session.open('d/x.py')
    session.edit('d/x.py', 'X2')
    await fs.remove('d')
    await session.removed('d')
    expect(session.state.open).toEqual([])
    await vi.advanceTimersByTimeAsync(600) // must not resurrect the file
    expect(await fs.exists('d/x.py')).toBe(false)
  })

  it('moved keeps the tab under the new name', async () => {
    await fs.write('d/x.py', 'X')
    await session.open('d/x.py')
    await fs.write('e/x.py', 'X')
    await fs.remove('d')
    await session.moved('d', 'e')
    expect(session.state.open).toEqual(['e/x.py'])
    expect(session.state.active).toBe('e/x.py')
    expect(calls.at(-1)).toBe('show e/x.py:X')
  })

  it('moved carries an unsaved edit to the new name', async () => {
    await fs.write('d/x.py', 'X')
    await session.open('d/x.py')
    session.edit('d/x.py', 'typed')
    await fs.write('e/x.py', 'X')
    await fs.remove('d')
    await session.moved('d', 'e')
    expect(calls.at(-1)).toBe('show e/x.py:typed')
    await vi.advanceTimersByTimeAsync(600)
    expect(await fs.read('e/x.py')).toBe('typed')
    expect(await fs.exists('d/x.py')).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { MemoryFs } from '../workspace'
import { changeCount, diffLines, hunks } from './diff'
import { History, compare, hashText } from './history'

describe('diffLines', () => {
  it('marks added, removed and unchanged lines with their numbers', () => {
    const d = diffLines('a\nb\nc', 'a\nx\nc\nd')
    expect(d.map((l) => `${l.kind}:${l.text}`)).toEqual(['same:a', 'del:b', 'add:x', 'same:c', 'add:d'])
    expect(d[1]).toMatchObject({ oldNo: 2, newNo: null })
    expect(d[2]).toMatchObject({ oldNo: null, newNo: 2 })
    expect(d[3]).toMatchObject({ oldNo: 3, newNo: 3 })
  })
  it('handles empty texts and identical texts', () => {
    expect(diffLines('', '')).toEqual([])
    expect(diffLines('', 'a').map((l) => l.kind)).toEqual(['add'])
    expect(diffLines('a', '').map((l) => l.kind)).toEqual(['del'])
    expect(changeCount(diffLines('a\nb', 'a\nb'))).toBe(0)
  })
  it('finds the minimal change in the middle', () => {
    const old = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n')
    const edited = old.replace('line 25', 'line twenty-five')
    expect(changeCount(diffLines(old, edited))).toBe(2)
  })
  it('falls back to replaced for huge differing texts instead of freezing', () => {
    const a = Array.from({ length: 2500 }, (_, i) => `a${i}`).join('\n')
    const b = Array.from({ length: 2500 }, (_, i) => `b${i}`).join('\n')
    const d = diffLines(a, b)
    expect(d.filter((l) => l.kind === 'del')).toHaveLength(2500)
    expect(d.filter((l) => l.kind === 'add')).toHaveLength(2500)
  })
  it('cuts the output down to the changes with context', () => {
    const old = Array.from({ length: 40 }, (_, i) => `l${i}`).join('\n')
    const edited = old.replace('l5\n', 'L5\n').replace('l30\n', 'L30\n')
    const h = hunks(diffLines(old, edited), 2)
    expect(h).toHaveLength(2)
    expect(h[0]?.lines.length).toBeLessThan(8)
    expect(hunks(diffLines(old, old))).toEqual([])
  })
})

describe('hashText', () => {
  it('is deterministic and tells texts apart', () => {
    expect(hashText('print(1)')).toBe(hashText('print(1)'))
    expect(hashText('print(1)')).not.toBe(hashText('print(2)'))
    expect(hashText('')).not.toBe(hashText(' '))
    expect(hashText('x'.repeat(1000))).not.toBe(hashText('x'.repeat(1001)))
  })
})

function make(options = {}) {
  let t = 1_000_000
  const fs = new MemoryFs()
  return { fs, history: new History(fs, { now: () => (t += 1000), ...options }) }
}

describe('History', () => {
  it('records, lists newest first and reads a snapshot back', async () => {
    const { history } = make()
    const a = await history.record({ 'main.py': 'v1', 'classes/A.py': 'a' }, 'open')
    const b = await history.record({ 'main.py': 'v2', 'classes/A.py': 'a' }, 'run')
    expect((await history.list()).map((s) => s.id)).toEqual([b?.id, a?.id])
    expect(await history.read(a?.id as string)).toEqual({ 'main.py': 'v1', 'classes/A.py': 'a' })
  })
  it('does not record the same state twice, but a named one always', async () => {
    const { history } = make()
    expect(await history.record({ 'main.py': 'x' }, 'open')).not.toBeNull()
    expect(await history.record({ 'main.py': 'x' }, 'run')).toBeNull()
    expect(await history.record({ 'main.py': 'x' }, 'manual', 'Mein Stand')).toMatchObject({ label: 'Mein Stand' })
    expect(await history.list()).toHaveLength(2)
  })
  it('stores each distinct text once', async () => {
    const { fs, history } = make()
    for (let i = 0; i < 5; i++) await history.record({ 'main.py': `version ${i}`, 'classes/Big.py': 'unchanged '.repeat(100) }, 'timer')
    const objects = (await fs.list()).filter((e) => e.path.startsWith('objects/'))
    expect(objects).toHaveLength(6) // 5 versions of main.py + one Big.py
  })
  it('survives a new History on the same storage (reload)', async () => {
    const { fs, history } = make()
    const s = await history.record({ 'main.py': 'keep' }, 'manual', 'Stand A')
    const again = new History(fs)
    expect((await again.list())[0]).toMatchObject({ id: s?.id, label: 'Stand A' })
    expect(await again.read(s?.id as string)).toEqual({ 'main.py': 'keep' })
  })
  it('starts over when the index is damaged', async () => {
    const { fs } = make()
    await fs.write('index.json', '{not json')
    const history = new History(fs)
    expect(await history.list()).toEqual([])
    expect(await history.record({ 'a.py': '1' }, 'open')).not.toBeNull()
  })
  it('labels, removes and cleans up unreferenced texts', async () => {
    const { fs, history } = make()
    const a = await history.record({ 'main.py': 'one' }, 'open')
    const b = await history.record({ 'main.py': 'two' }, 'run')
    await history.label(b?.id as string, ' Schleife fertig ')
    expect((await history.list())[0]?.label).toBe('Schleife fertig')
    await history.remove(a?.id as string)
    expect((await fs.list()).filter((e) => e.path.startsWith('objects/'))).toHaveLength(1)
    await history.label(b?.id as string, '')
    expect((await history.list())[0]?.label).toBeUndefined()
  })
  it('drops the oldest automatic snapshots beyond the limit and keeps named ones', async () => {
    const { history } = make({ maxSnapshots: 4 })
    const named = await history.record({ 'main.py': 'v0' }, 'manual', 'Wichtig')
    for (let i = 1; i <= 8; i++) await history.record({ 'main.py': `v${i}` }, 'timer')
    const list = await history.list()
    expect(list).toHaveLength(4)
    expect(list.some((s) => s.id === named?.id)).toBe(true)
    expect(list[0]?.reason).toBe('timer')
  })
  it('respects the size limit', async () => {
    const { history } = make({ maxChars: 300 })
    for (let i = 0; i < 6; i++) await history.record({ 'main.py': `${i}`.repeat(100) }, 'timer')
    const list = await history.list()
    expect(list.length).toBeLessThanOrEqual(3)
    expect(list.length).toBeGreaterThanOrEqual(1)
  })
  it('keeps order for snapshots in the same millisecond and for concurrent calls', async () => {
    const fs = new MemoryFs()
    const history = new History(fs, { now: () => 5000 })
    await Promise.all(['a', 'b', 'c'].map((t) => history.record({ 'main.py': t }, 'timer')))
    const list = await history.list()
    expect(list).toHaveLength(3)
    expect(new Set(list.map((s) => s.time)).size).toBe(3)
    expect(await history.read(list[0]?.id as string)).toEqual({ 'main.py': 'c' })
  })
  it('rejects an unknown snapshot', async () => {
    const { history } = make()
    await expect(history.read('nope')).rejects.toThrow('snapshot-not-found')
  })
})

describe('compare', () => {
  it('says what restoring would change', () => {
    expect(compare({ 'a.py': '1', 'b.py': '2', 'c.py': '3' }, { 'a.py': '1', 'b.py': 'changed', 'd.py': '4' })).toEqual({
      'a.py': 'same',
      'b.py': 'changed',
      'c.py': 'missing',
      'd.py': 'new',
    })
  })
  it('is not fooled by names like constructor', () => {
    expect(compare({ constructor: 'x' }, {})).toEqual({ constructor: 'missing' })
  })
})

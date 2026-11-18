import { describe, expect, it } from 'vitest'
import { MemoryFs } from '../workspace'
import { append, fromWorld, handleFor, keyFor, MAX_OPS, replay, type JournalClient, type Op } from './journal'
import { emptyMeta, loadMeta, parseMeta, saveMeta } from './meta'
import type { ActorInfo } from './scenario'
import { fakeWorld as fakeWorld0 } from './fakeWorld'

function fakeWorld(initial: Array<[string, number, number]> = []) {
  const w = fakeWorld0(initial)
  return { world: {
      actors: w.actors,
      get calls() {
        return w.state.log.filter((l) => l.startsWith('call ')).map((l) => l.slice(5))
      },
    }, client: w.client as JournalClient, raw: w }
}

describe('journal keys', () => {
  const actors = [
    { handle: 'a', cls: 'Krabbe' },
    { handle: 'b', cls: 'Wurm' },
    { handle: 'c', cls: 'Krabbe' },
  ] as ActorInfo[]
  it('addresses actors by class and index within the class', () => {
    expect(keyFor(actors, 'c')).toEqual({ cls: 'Krabbe', n: 1 })
    expect(keyFor(actors, 'zz')).toBeNull()
    expect(handleFor(actors, 'Krabbe', 1)).toBe('c')
    expect(handleFor(actors, 'Krabbe', 2)).toBeNull()
  })
})

describe('append', () => {
  it('merges consecutive moves of the same actor only', () => {
    let ops: Op[] = []
    ops = append(ops, { op: 'move', cls: 'K', n: 0, x: 1, y: 1 })
    ops = append(ops, { op: 'move', cls: 'K', n: 0, x: 5, y: 6 })
    ops = append(ops, { op: 'move', cls: 'K', n: 1, x: 9, y: 9 })
    expect(ops).toEqual([
      { op: 'move', cls: 'K', n: 0, x: 5, y: 6 },
      { op: 'move', cls: 'K', n: 1, x: 9, y: 9 },
    ])
  })
  it('does not mutate and caps the length', () => {
    const a: Op[] = [{ op: 'clear' }]
    append(a, { op: 'clear' })
    expect(a).toHaveLength(1)
    let ops: Op[] = []
    for (let i = 0; i < MAX_OPS + 20; i++) ops = append(ops, { op: 'place', cls: 'K', x: i, y: 0 })
    expect(ops).toHaveLength(MAX_OPS)
    expect(ops.at(-1)).toMatchObject({ x: MAX_OPS + 19 })
  })
})

describe('replay', () => {
  it('rebuilds a hand-made setup after a restart', async () => {
    const ops: Op[] = [
      { op: 'place', cls: 'Krabbe', x: 10, y: 20 },
      { op: 'place', cls: 'Wurm', x: 30, y: 40 },
      { op: 'move', cls: 'Wurm', n: 0, x: 50, y: 60 },
      { op: 'call', cls: 'Krabbe', n: 0, method: 'fressen', texts: ['2'] },
    ]
    const { world, client } = fakeWorld()
    expect(await replay(client, ops)).toEqual({ total: 4, failed: 0, firstError: '' })
    expect(world.actors.map((a) => [a.cls, a.x, a.y])).toEqual([['Krabbe', 10, 20], ['Wurm', 50, 60]])
    expect(world.calls).toEqual(['h1.fressen(2)'])
  })

  it('skips steps that no longer fit and reports the first problem', async () => {
    const { client } = fakeWorld()
    const result = await replay(client, [
      { op: 'move', cls: 'Wurm', n: 3, x: 1, y: 1 },
      { op: 'delete', cls: 'Wurm', n: 0 },
      { op: 'place', cls: 'Krabbe', x: 1, y: 1 },
    ])
    expect(result.total).toBe(3)
    expect(result.failed).toBe(2)
    expect(result.firstError).toBe('Wurm Nr. 4 gibt es nicht mehr.')
  })

  it('clear empties the world the program created, then places again', async () => {
    const { world, client } = fakeWorld([['Krabbe', 1, 1], ['Krabbe', 2, 2]])
    await replay(client, [{ op: 'clear' }, { op: 'place', cls: 'Wurm', x: 5, y: 5 }])
    expect(world.actors.map((a) => a.cls)).toEqual(['Wurm'])
  })

  it('fromWorld captures the current world including directions', async () => {
    const { world, client } = fakeWorld([['Krabbe', 10.123, 20], ['Wurm', 3, 4]])
    world.actors[0]!.direction = 90
    expect(await fromWorld(client)).toEqual([
      { op: 'clear' },
      { op: 'place', cls: 'Krabbe', x: 10.12, y: 20, dir: 90 },
      { op: 'place', cls: 'Wurm', x: 3, y: 4 },
    ])
    const again = fakeWorld()
    await replay(again.client, await fromWorld(client))
    expect(again.world.actors.map((a) => [a.cls, a.direction])).toEqual([['Krabbe', 90], ['Wurm', 0]])
  })
})

describe('miniworlds.json', () => {
  it('reads what the old web client wrote', () => {
    const old = JSON.stringify({ journal: [{ op: 'place', cls: 'Krabbe', x: 1, y: 2, args: [] }], tasks: ['A', 'B'], tasksDone: { 0: true, 1: false } })
    expect(parseMeta(old)).toEqual({ journal: [{ op: 'place', cls: 'Krabbe', x: 1, y: 2, args: [] }], tasks: ['A', 'B'], tasksDone: { 0: true } })
  })
  it('survives garbage', () => {
    expect(parseMeta('{nope')).toEqual(emptyMeta())
    expect(parseMeta('42')).toEqual(emptyMeta())
    expect(parseMeta(JSON.stringify({ journal: [{ op: 'rm -rf' }, 5, { op: 'clear' }], tasks: [1, 'x'] }))).toEqual({
      journal: [{ op: 'clear' }],
      tasks: ['x'],
      tasksDone: {},
    })
  })
  it('round-trips through the file system and removes the file when empty', async () => {
    const fs = new MemoryFs()
    const meta = { journal: [{ op: 'clear' } as Op], tasks: ['T'], tasksDone: { 0: true } }
    await saveMeta(fs, meta)
    expect(await loadMeta(fs)).toEqual(meta)
    await saveMeta(fs, emptyMeta())
    expect(await fs.exists('miniworlds.json')).toBe(false)
    expect(await loadMeta(fs)).toEqual(emptyMeta())
  })
  it('still reads the old name greenfoot.json and replaces it on the next save', async () => {
    const fs = new MemoryFs()
    await fs.write('greenfoot.json', JSON.stringify({ journal: [{ op: 'clear' }], tasks: ['T'], tasksDone: {} }))
    const meta = await loadMeta(fs)
    expect(meta.tasks).toEqual(['T'])
    await saveMeta(fs, meta)
    expect(await fs.exists('greenfoot.json')).toBe(false)
    expect(await fs.exists('miniworlds.json')).toBe(true)
    expect(await loadMeta(fs)).toEqual(meta)
  })
  it('keeps the old file when writing the new one fails', async () => {
    const fs = new MemoryFs()
    await fs.write('greenfoot.json', JSON.stringify({ journal: [], tasks: ['T'], tasksDone: {} }))
    fs.write = async () => {
      throw new Error('quota')
    }
    await expect(saveMeta(fs, { journal: [], tasks: ['T'], tasksDone: {} })).rejects.toThrow('quota')
    expect(await fs.exists('greenfoot.json')).toBe(true)
  })
})

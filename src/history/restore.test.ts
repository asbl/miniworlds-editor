import { describe, expect, it } from 'vitest'
import { Session, type Surface } from '../ui/session'
import { MemoryFs } from '../workspace'
import { History } from './history'
import { readTexts, restoreAll, restoreFile } from './restore'

const surface: Surface = { show() {}, clear() {}, forget() {}, reveal() {}, markError() {}, clearErrors() {} }

async function setup() {
  const fs = new MemoryFs()
  await fs.write('main.py', 'v1')
  await fs.write('classes/A.py', 'a1')
  await fs.write('images/x.png', new Uint8Array([1, 2, 3]))
  await fs.write('miniworlds.json', '{"tasks":["x"]}')
  const session = new Session(fs, surface, 10_000)
  const history = new History(new MemoryFs())
  let edits = 0
  session.subscribeEdits(() => edits++)
  return { fs, session, history, edits: () => edits, deps: { fs, session, history } }
}

describe('readTexts', () => {
  it('reads text files only, with unsaved typing, without the view state file', async () => {
    const { fs, session } = await setup()
    session.edit('main.py', 'typed')
    expect(await readTexts(fs, session)).toEqual({ 'main.py': 'typed', 'classes/A.py': 'a1' })
  })
})

describe('restore', () => {
  it('puts back one file and remembers the state before', async () => {
    const { fs, session, history, deps, edits } = await setup()
    const old = await history.record(await readTexts(fs, session), 'open')
    await fs.write('main.py', 'v2')
    await restoreFile(deps, old?.id as string, 'main.py')
    expect(await fs.read('main.py')).toBe('v1')
    expect(edits()).toBe(1)
    const list = await history.list()
    expect(list[0]?.reason).toBe('before-restore')
    expect(await history.read(list[0]?.id as string)).toMatchObject({ 'main.py': 'v2' })
  })
  it('brings back a deleted file', async () => {
    const { fs, session, history, deps } = await setup()
    const old = await history.record(await readTexts(fs, session), 'open')
    await fs.remove('classes/A.py')
    await restoreFile(deps, old?.id as string, 'classes/A.py')
    expect(await fs.read('classes/A.py')).toBe('a1')
  })
  it('restores everything: rewrites, brings back, removes newer files, keeps pictures and view state', async () => {
    const { fs, session, history, deps } = await setup()
    const old = await history.record(await readTexts(fs, session), 'open')
    await fs.write('main.py', 'v2')
    await fs.remove('classes/A.py')
    await fs.write('classes/New.py', 'n')
    const result = await restoreAll(deps, old?.id as string)
    expect(result).toEqual({ written: 2, removed: 1 })
    expect(await readTexts(fs, null)).toEqual({ 'main.py': 'v1', 'classes/A.py': 'a1' })
    expect(await fs.exists('images/x.png')).toBe(true)
    expect(await fs.exists('miniworlds.json')).toBe(true)
  })
  it('can be undone by restoring the state it remembered', async () => {
    const { fs, session, history, deps } = await setup()
    const old = await history.record(await readTexts(fs, session), 'open')
    await fs.write('main.py', 'precious new work')
    await restoreAll(deps, old?.id as string)
    expect(await fs.read('main.py')).toBe('v1')
    const undo = (await history.list()).find((s) => s.reason === 'before-restore')
    await restoreAll(deps, undo?.id as string)
    expect(await fs.read('main.py')).toBe('precious new work')
  })
  it('refuses a file the snapshot does not have', async () => {
    const { fs, session, history, deps } = await setup()
    const old = await history.record(await readTexts(fs, session), 'open')
    await expect(restoreFile(deps, old?.id as string, 'nope.py')).rejects.toThrow('file-not-in-snapshot')
  })
})

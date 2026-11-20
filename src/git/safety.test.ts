import 'fake-indexeddb/auto'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { Repository } from './repository'
import { MemoryStore } from '../workspace/projects'

beforeAll(() => { if (typeof navigator === 'undefined') Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true }) })
afterEach(() => vi.unstubAllGlobals())
const credentials = { username: '', token: '' }
const author = { name: 'Student', email: 'student@example.test' }
const connection = { url: 'https://audit.example/game.git', branch: 'main', proxy: '' }
async function setup() {
  const ws = await new MemoryStore().open('Game')
  await ws.fs.write('main.py', 'original')
  const repo = await Repository.create(ws, connection, false, credentials)
  await repo.commit('Initial', author)
  return { ws, repo }
}
it('preserves edits and new files from a second writer when fetch fails', async () => {
  const { ws, repo } = await setup()
  vi.stubGlobal('fetch', async () => {
    await ws.fs.write('main.py', 'new student work')
    await ws.fs.write('new.py', 'new file from second tab')
    throw new Error('Network disconnected')
  })
  await expect(repo.pull(credentials)).rejects.toThrow('Network disconnected')
  expect(await ws.fs.read('main.py')).toBe('new student work')
  expect(await ws.fs.read('new.py')).toBe('new file from second tab')
  expect(await repo.hasRecoveryArchive()).toBe(false)
  expect(await repo.changes()).toEqual(['main.py', 'new.py'])
})
it('cancels a pending pull without rewriting local files', async () => {
  const { ws, repo } = await setup()
  const controller = new AbortController()
  let started!: () => void
  const requested = new Promise<void>(resolve => { started = resolve })
  vi.stubGlobal('fetch', async (_url: unknown, options: RequestInit) => {
    await ws.fs.write('main.py', 'saved while waiting')
    return new Promise((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true })
      started()
    })
  })
  const pull = repo.pull(credentials, { signal: controller.signal })
  const assertion = expect(pull).rejects.toMatchObject({ name: 'AbortError' })
  await requested
  controller.abort()
  await assertion
  expect(await ws.fs.read('main.py')).toBe('saved while waiting')
})
it('cleans repository storage when a clone is cancelled', async () => {
  const ws = await new MemoryStore().open('Cancelled')
  const controller = new AbortController()
  let started!: () => void
  const requested = new Promise<void>(resolve => { started = resolve })
  vi.stubGlobal('fetch', (_url: unknown, options: RequestInit) => new Promise((_resolve, reject) => {
    options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true })
    started()
  }))
  const clone = Repository.create(ws, connection, true, credentials, { signal: controller.signal })
  const assertion = expect(clone).rejects.toMatchObject({ name: 'AbortError' })
  await requested; controller.abort(); await assertion
  expect(await Repository.open(ws)).toBeNull()
  expect((await ws.history!.list()).filter(entry => entry.kind === 'file')).toEqual([])
  expect(await ws.fs.list()).toEqual([])
})

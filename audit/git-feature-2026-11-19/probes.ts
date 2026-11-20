import 'fake-indexeddb/auto'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { Repository } from '../../src/git/repository'
import { MemoryStore } from '../../src/workspace/projects'
beforeAll(() => { if (typeof navigator === 'undefined') Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true }) })
afterEach(() => vi.unstubAllGlobals())
const credentials = { username: '', token: '' }
const author = { name: 'Audit', email: 'audit@example.test' }
async function setup() {
  const ws = await new MemoryStore().open('Audit')
  await ws.fs.write('main.py', 'original')
  const repo = await Repository.create(ws, { url: 'https://audit.example/game.git', branch: 'main', proxy: '' }, false, credentials)
  await repo.commit('Initial', author)
  return { ws, repo }
}
it('CONFIRMED: failed pull overwrites a concurrent edit and deletes a new local file', async () => {
  const { ws, repo } = await setup()
  vi.stubGlobal('fetch', async () => {
    // Simulate autosave from a second tab after the clean-tree check.
    await ws.fs.write('main.py', 'new student work')
    await ws.fs.write('new.py', 'new file from second tab')
    throw new Error('Network disconnected')
  })
  await expect(repo.pull(credentials)).rejects.toThrow('Network disconnected')
  expect(await ws.fs.read('main.py')).toBe('original')
  expect(await ws.fs.exists('new.py')).toBe(false)
})
it('CONFIRMED: network requests have no cancellation signal', async () => {
  const { repo } = await setup()
  const signals: unknown[] = []
  vi.stubGlobal('fetch', async (_url: unknown, options: RequestInit) => {
    signals.push(options.signal)
    throw new Error('Audit stopped request')
  })
  await expect(repo.pull(credentials)).rejects.toThrow('Audit stopped request')
  expect(signals.length).toBeGreaterThan(0)
  expect(signals.every(signal => signal === undefined)).toBe(true)
})

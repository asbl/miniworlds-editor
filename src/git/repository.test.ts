import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { Repository, validateConnection } from './repository'
import { MemoryStore } from '../workspace/projects'
import { gitStorage } from './storage'
import { MemoryFs } from '../workspace/memory'

beforeAll(() => { if (typeof navigator === 'undefined') Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true }) })
const connection = { url: 'https://example.com/class/game.git', branch: 'main', proxy: '' }
const credentials = { username: '', token: '' }
const author = { name: 'Student', email: 'student@example.test' }

describe('optional browser Git', () => {
  it('round-trips the Git tree and binary objects in separate storage', async () => {
    const fs = new MemoryFs(); const storage = gitStorage(fs)
    const tree = new Map([['repo', new Map([['file', { mode: 33188, ino: 7 }]])]])
    await storage.saveSuperblock(tree as never)
    await storage.writeFile(7, new Uint8Array([0, 255, 123]))
    expect(await storage.loadSuperblock()).toEqual(tree)
    expect(await storage.readFile(7)).toEqual(new Uint8Array([0, 255, 123]))
  })
  it('commits additions, binary changes and deletions, and persists across reopening and rename', async () => {
    const store = new MemoryStore(); const ws = await store.open('Game')
    await ws.fs.write('main.py', 'print(1)')
    await ws.fs.write('images/player.png', new Uint8Array([0, 255, 1]))
    expect(await Repository.open(ws)).toBeNull()
    const repo = await Repository.create(ws, connection, false, credentials)
    expect(await repo.changes()).toEqual(['images/player.png', 'main.py'])
    expect(await repo.commit('First version', author)).toMatch(/^[a-f0-9]{40}$/)
    expect(await repo.changes()).toEqual([])
    await ws.fs.remove('main.py')
    await ws.fs.write('images/player.png', new Uint8Array([2, 254]))
    expect(await repo.changes()).toEqual(['images/player.png', 'main.py'])
    await repo.commit('Remove main and update image', author)
    expect(await repo.changes()).toEqual([])
    const renamed = await store.open('Renamed')
    for (const file of await ws.fs.list()) if (file.kind === 'file') await renamed.fs.write(file.path, await ws.fs.readBytes(file.path))
    for (const file of await ws.history!.list()) if (file.kind === 'file') await renamed.history!.write(file.path, await ws.history!.readBytes(file.path))
    const reopened = await Repository.open(renamed)
    expect(reopened?.connection.url).toBe(connection.url)
    expect(await reopened!.changes()).toEqual([])
    expect((await ws.fs.list()).some(e => e.path.includes('.git'))).toBe(false)
    expect(JSON.stringify(await ws.history!.list())).not.toContain('token')
  })
  it('handles file/directory replacement and refuses dirty pulls before networking', async () => {
    const ws = await new MemoryStore().open('Replacement')
    const repo = await Repository.create(ws, connection, false, credentials)
    await ws.fs.write('thing/nested.py', 'original')
    await repo.commit('Initial', author)
    await ws.fs.remove('thing')
    await ws.fs.write('thing', 'now a file')
    expect(await repo.changes()).toEqual(['thing', 'thing/nested.py'])
    await expect(repo.pull(credentials)).rejects.toThrow('Commit local changes')
    expect(await ws.fs.read('thing')).toBe('now a file')
    await repo.commit('Replace directory', author)
    expect(await repo.changes()).toEqual([])
  })
  it('respects .gitignore and updates connection details without storing credentials', async () => {
    const ws = await new MemoryStore().open('Ignored')
    await ws.fs.write('.gitignore', '*.secret\n')
    await ws.fs.write('password.secret', 'do not commit')
    await ws.fs.write('main.py', 'print(1)')
    const repo = await Repository.create(ws, connection, false, { username: 'private-user', token: 'private-token' })
    expect(await repo.changes()).toEqual(['.gitignore', 'main.py'])
    await repo.commit('Ignore secrets', author)
    expect(await repo.changes()).toEqual([])
    await repo.updateConnection('https://gitlab.example/class/game.git', 'https://proxy.example')
    expect(repo.connection.url).toBe('https://gitlab.example/class/game.git')
    const config = await ws.history!.read('git/connection.json')
    expect(config).not.toContain('private-token')
    expect(config).not.toContain('private-user')
    expect(JSON.parse(config).branch).toBe('main')
  })
  it('rejects credentials in URLs and unsupported transports', () => {
    expect(() => validateConnection({ ...connection, url: 'https://user:secret@example.com/game' })).toThrow()
    expect(() => validateConnection({ ...connection, url: 'ssh://example.com/game' })).toThrow()
    expect(() => validateConnection({ ...connection, proxy: 'https://proxy.test/?token=secret' })).toThrow()
    expect(() => validateConnection(connection)).not.toThrow()
  })
})

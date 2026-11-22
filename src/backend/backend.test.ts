import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryFs, MemoryStore } from '../workspace'
import { BackendClient, decode, encode, type RemoteProject } from './client'
import { BackendConnection, BackendProjects } from './projects'
import { parseAppConfig } from '../config/appConfig'

class TestStorage implements Storage {
  private data = new Map<string, string>()
  get length() { return this.data.size }
  clear() { this.data.clear() }
  getItem(key: string) { return this.data.get(key) ?? null }
  key(index: number) { return [...this.data.keys()][index] ?? null }
  removeItem(key: string) { this.data.delete(key); delete (this as unknown as Record<string, unknown>)[key] }
  setItem(key: string, value: string) { this.data.set(key, String(value)); Object.defineProperty(this, key, { value: String(value), enumerable: true, configurable: true }) }
}
const project = (): RemoteProject => ({ project_id: 3, title: 'Projekt', revision: 1, read_only: false, read_only_reason: null,
  code_expires_at: null, password_protected: false, save: { source: 'print(1)', db: null }, media: [], tasks: [] })
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
const sessions: BackendConnection[] = []
afterEach(() => { sessions.forEach(s => s.dispose()); sessions.length = 0; vi.unstubAllGlobals(); vi.useRealTimers() })

async function connection(fetcher: typeof fetch, p = project()) {
  const fs = new MemoryFs(); await fs.write('main.py', 'print(1)')
  const meta = new TestStorage()
  const data = { id: p.project_id, revision: p.revision, dirty: false, project: p }
  meta.setItem('test', JSON.stringify(data))
  const conn = new BackendConnection('Test', { kind: 'memory', fs }, new BackendClient('https://backend.test', 'secret', fetcher), data, meta, 'test')
  sessions.push(conn)
  return { conn, fs, meta }
}

describe('optional backend', () => {
  it('defaults to independent local storage and accepts only safe deployment addresses', () => {
    for (const value of [undefined, null, 'javascript:alert(1)', 'http://remote.test', 'https://user:pass@test', 'https://test/?token=oops'])
      expect(parseAppConfig({ backendUrl: value }, 'https://editor.test/').backendUrl).toBeNull()
    expect(parseAppConfig({ backendUrl: 'https://backend.test/' }, 'https://editor.test/').backendUrl).toBe('https://backend.test')
    expect(parseAppConfig({ backendUrl: 'http://localhost:8000' }, 'http://localhost/').backendUrl).toBe('http://localhost:8000')
  })
  it('sends scoped tokens in headers and excludes cookies and caches', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json({ ok: true }))
    const client = new BackendClient('https://backend.test', 'secret', fetcher)
    await client.json('/api/play/project')
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://backend.test/api/play/project')
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ credentials: 'omit', cache: 'no-store', redirect: 'error', headers: { Authorization: 'Bearer secret' } })
    await client.json('/api/claim', 'POST', { code: 'CODE' })
    expect(fetcher.mock.calls[1]?.[1]?.headers).not.toHaveProperty('Authorization')
  })
  it('round trips binary files larger than a JS argument limit', () => {
    const bytes = Uint8Array.from({ length: 150000 }, (_, n) => n % 256)
    expect(decode(encode(bytes))).toEqual(bytes)
  })
  it('keeps failed saves locally across reopening, including deletions and multiple files', async () => {
    const failed = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'))
    const { conn, fs, meta } = await connection(failed)
    await conn.workspace.fs.write('classes/Crab.py', 'class Crab: pass')
    await conn.workspace.fs.write('sound.bin', new Uint8Array([0, 255]))
    await conn.workspace.fs.remove('main.py')
    await conn.sync()
    expect(conn.status).toBe('offline'); expect(conn.dirty).toBe(true)
    const send = vi.fn<typeof fetch>().mockResolvedValue(json({ revision: 2 }))
    const restored = new BackendConnection('Test', { kind: 'memory', fs }, new BackendClient('https://backend.test', 'token', send), JSON.parse(meta.getItem('test')!), meta, 'test')
    sessions.push(restored)
    await restored.sync()
    const body = JSON.parse(send.mock.calls[0]![1]!.body as string)
    expect(body.base_revision).toBe(1)
    expect(decode(body.files['classes/Crab.py'])).toEqual(new TextEncoder().encode('class Crab: pass'))
    expect(decode(body.files['sound.bin'])).toEqual(new Uint8Array([0, 255]))
    expect(body.files).not.toHaveProperty('main.py')
    expect(restored.dirty).toBe(false)
  })
  it('never overwrites a newer server after a conflict, and keeps later edits', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(json({ detail: 'newer version' }, 409))
    const { conn, fs } = await connection(send)
    await conn.workspace.fs.write('main.py', 'local = 2')
    await conn.sync()
    expect(conn.status).toBe('conflict')
    await conn.workspace.fs.write('main.py', 'local = 3')
    await conn.sync()
    expect(send).toHaveBeenCalledTimes(1)
    expect(await fs.read('main.py')).toBe('local = 3')
    expect(conn.dirty).toBe(true)
  })
  it('blocks changed files for read-only projects but permits reads and identical metadata writes', async () => {
    const { conn } = await connection(vi.fn(), { ...project(), read_only: true })
    expect(await conn.workspace.fs.read('main.py')).toBe('print(1)')
    await conn.workspace.fs.write('main.py', 'print(1)')
    await expect(conn.workspace.fs.write('main.py', 'changed')).rejects.toThrow('Schreibgeschützt')
    await expect(conn.workspace.fs.remove('main.py')).rejects.toThrow()
    expect(conn.dirty).toBe(false)
  })
  it('preserves boolean task drafts offline, without accepting free text', async () => {
    const p = project(); p.tasks = [{ assignment_id: 9, title: 'Aufgabe', description: '', status: 'open', version: 2, items: [{ id: 4, kind: 'checkbox', prompt: 'Fertig' }], answers: {} }]
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'))
    const { conn, meta } = await connection(fetcher, p)
    await conn.answer(9, 4, true)
    expect(conn.dirty).toBe(true)
    expect(JSON.parse(meta.getItem('test')!).answerDrafts['9']).toEqual({ base_version: 2, answers: { '4': { checked: true } } })
    fetcher.mockResolvedValue(json({ version: 3 }))
    await conn.retry()
    expect(conn.dirty).toBe(false)
    expect(conn.project.tasks[0]?.version).toBe(3)
  })
  it('retains new personal code and token when a template is consumed but download fails', async () => {
    const meta = new TestStorage(), secrets = new TestStorage(), store = new MemoryStore()
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ token: 'token', project_id: 3, personal_code: 'PERSONAL' })).mockRejectedValue(new TypeError('offline'))
    vi.stubGlobal('fetch', send)
    const manager = new BackendProjects(store, 'https://backend.test', meta, secrets)
    await expect(manager.claim('TEMPLATE', '')).rejects.toThrow('offline')
    expect(manager.pendingCodes()).toEqual([{ name: 'Server-Projekt 3', code: 'PERSONAL' }])
    expect(JSON.stringify(meta)).not.toContain('PERSONAL')
    send.mockResolvedValue(json(project()))
    const resumed = await manager.resume('Server-Projekt 3'); sessions.push(resumed!)
    expect(await resumed!.workspace.fs.read('main.py')).toBe('print(1)')
  })
  it('does not overwrite a pending draft when reconnecting to a changed server', async () => {
    const meta = new TestStorage(), secrets = new TestStorage(), store = new MemoryStore()
    const send = vi.fn<typeof fetch>().mockImplementation(async path => String(path).endsWith('/claim') ? json({ token: 'token', project_id: 3 }) : json(project()))
    vi.stubGlobal('fetch', send)
    const manager = new BackendProjects(store, 'https://backend.test', meta, secrets)
    await manager.claim('CODE', '')
    const first = await manager.open('Server-Projekt 3', await store.open('Server-Projekt 3')); sessions.push(first!)
    await first!.workspace.fs.write('main.py', 'my draft')
    send.mockResolvedValue(json({ ...project(), revision: 5, save: { source: 'someone else', db: null } }))
    const second = await manager.resume('Server-Projekt 3'); sessions.push(second!)
    expect(await second!.workspace.fs.read('main.py')).toBe('my draft')
    expect(second!.revision).toBe(1)
  })
  it('removes local project and credentials on logout and stores large files outside localStorage', async () => {
    const meta = new TestStorage(), secrets = new TestStorage(), store = new MemoryStore()
    const send = vi.fn<typeof fetch>().mockImplementation(async path => String(path).endsWith('/claim') ? json({ token: 'token', project_id: 3 }) : json({ ...project(), save: { source: 'x'.repeat(100000), db: null } }))
    vi.stubGlobal('fetch', send)
    const manager = new BackendProjects(store, 'https://backend.test', meta, secrets)
    await manager.claim('CODE', '')
    const conn = await manager.open('Server-Projekt 3', await store.open('Server-Projekt 3')); sessions.push(conn!)
    expect(meta.getItem(manager.key('Server-Projekt 3'))!.length).toBeLessThan(2000)
    await manager.logout(conn!)
    expect(await store.list()).toEqual([])
    expect(meta.getItem(manager.key('Server-Projekt 3'))).toBeNull()
    expect(secrets.getItem(manager.key('Server-Projekt 3'))).toBeNull()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryStore } from '../workspace'
import { ltiAssertion, withoutLti } from './lti'
import { BackendProjects, type BackendConnection } from './projects'

class TestStorage implements Storage {
  private data = new Map<string, string>()
  get length() { return this.data.size }
  clear() { this.data.clear() }
  getItem(key: string) { return this.data.get(key) ?? null }
  key(index: number) { return [...this.data.keys()][index] ?? null }
  removeItem(key: string) { this.data.delete(key) }
  setItem(key: string, value: string) { this.data.set(key, String(value)) }
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
const project = () => ({ project_id: 3, title: 'Projekt', revision: 1, read_only: false, read_only_reason: null,
  code_expires_at: null, password_protected: false, save: { source: 'print(1)', db: null }, media: [], tasks: [] })
const sessions: BackendConnection[] = []
afterEach(() => { sessions.forEach(s => s.dispose()); sessions.length = 0; vi.unstubAllGlobals() })

describe('start aus Moodle', () => {
  it('liest die Zusicherung aus dem Fragment und lässt anderes stehen', () => {
    expect(ltiAssertion('#lti=abc.def')).toBe('abc.def')
    expect(ltiAssertion('#play=x&lti=abc.def')).toBe('abc.def')
    expect(ltiAssertion('lti=abc.def')).toBe('abc.def')
    expect(ltiAssertion('#play=x')).toBeNull()
    expect(ltiAssertion('')).toBeNull()
    expect(withoutLti('#lti=abc.def')).toBe('')
    expect(withoutLti('#lti=abc.def&play=x')).toBe('#play=x')
    expect(withoutLti('#play=x')).toBe('#play=x')
  })

  it('reicht die Zusicherung ans Backend weiter und öffnet das Projekt', async () => {
    const meta = new TestStorage(), secrets = new TestStorage(), store = new MemoryStore()
    const send = vi.fn<typeof fetch>().mockImplementation(async path =>
      String(path).endsWith('/lti-bind') ? json({ token: 'token', project_id: 3, personal_code: 'PERSONAL' }) : json(project()))
    vi.stubGlobal('fetch', send)
    const manager = new BackendProjects(store, 'https://backend.test', meta, secrets)
    const result = await manager.claimExternal('body.signatur')
    expect(send.mock.calls[0]?.[0]).toBe('https://backend.test/api/play/lti-bind')
    expect(JSON.parse(String(send.mock.calls[0]?.[1]?.body))).toEqual({ assertion: 'body.signatur' })
    expect(result.name).toBe('Server-Projekt 3')
    expect(result.personalCode).toBe('PERSONAL')
    const connection = await manager.open(result.name, await store.open(result.name))
    if (connection) sessions.push(connection)
    expect(connection?.client.token).toBe('token')
  })

  it('antwortet des Backends Fehler als Fehlversuch, damit der Code-Dialog erscheint', async () => {
    const meta = new TestStorage(), secrets = new TestStorage(), store = new MemoryStore()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(json({ error: 'nope' }, 401)))
    const manager = new BackendProjects(store, 'https://backend.test', meta, secrets)
    await expect(manager.claimExternal('falsch.signatur')).rejects.toThrow()
  })
})

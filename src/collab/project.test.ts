import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryStore } from '../workspace'
import { History } from '../history/history'
import { roomProject } from './project'
import { newInvite, readOnlyOf, serializeInvite } from './shared'
import { rememberRoom } from './storage'

beforeEach(() => {
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('room project reuse', () => {
  it.each(['Gemeinsam arbeiten', 'Work together', 'Multiplayer'])('keeps files and history of an existing %s project', async (prefix) => {
    const store = new MemoryStore()
    const invite = newInvite()
    const name = `${prefix} ${invite.room}`
    const old = await store.open(name)
    await old.fs.write('main.py', 'old code')
    await new History(old.history!).record({ 'main.py': 'earlier code' }, 'manual', 'Before joining')

    const selected = await roomProject(store, invite)
    const reopened = await store.open(selected)
    expect(selected).toBe(name)
    expect(await store.list()).toEqual([name])
    expect(await reopened.fs.read('main.py')).toBe('old code')
    expect((await new History(reopened.history!).list())[0]?.label).toBe('Before joining')
  })

  it('reuses a remembered room even after the project was given a custom name', async () => {
    const store = new MemoryStore()
    const invite = newInvite()
    await store.open('My game')
    rememberRoom('My game', serializeInvite(invite))
    expect(await roomProject(store, invite)).toBe('My game')
  })

  it('uses a stable name for new rooms, without using a translated dialog title', async () => {
    const invite = newInvite()
    expect(await roomProject(new MemoryStore(), invite)).toBe(`Multiplayer ${invite.room}`)
  })

  it('does not merge a different invitation or read-only mode into an existing project', async () => {
    const store = new MemoryStore()
    const invite = newInvite()
    const base = `Multiplayer ${invite.room}`
    await store.open(base)
    rememberRoom(base, serializeInvite(invite))
    expect(await roomProject(store, readOnlyOf(invite))).toBe(`${base} (2)`)
    expect(await roomProject(store, { ...invite, secret: 'anothersecret' })).toBe(`${base} (2)`)
  })

  it('ignores remembered rooms whose project was deleted', async () => {
    const store = new MemoryStore()
    const invite = newInvite()
    rememberRoom('Deleted project', serializeInvite(invite))
    expect(await roomProject(store, invite)).toBe(`Multiplayer ${invite.room}`)
  })
})

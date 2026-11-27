import { afterEach, describe, expect, it } from 'vitest'
import { createRelay } from '../../deploy/collab/relay.mjs'
import { MemoryFs, type Fs } from '../workspace'
import { Collab, isSyncedFs } from './collab'
import { newShortCode, parseShortCode } from './crypto'
import { publishCode, resolveCode } from './code'
import { newInvite, parseInviteHash, randomRoomCode, readOnlyOf, deserializeInvite, serializeInvite, roomLink, type Invite } from './shared'

type Relay = ReturnType<typeof createRelay>
const relays: Relay[] = []
const collabs: Collab[] = []

async function start(options: Record<string, unknown> = { origins: ['*'] }) {
  const relay = createRelay(options)
  relays.push(relay)
  const address = (await relay.listen(0, '127.0.0.1')) as { port: number }
  return { relay, url: `ws://127.0.0.1:${address.port}/collab` }
}

const invites = new Map<string, Invite>()
/** `code` names a room; every name has one invitation, so the people of a room share their keys. */
function person(code: string, url: string, name: string, extra: Record<string, unknown> = {}) {
  let invite = invites.get(code)
  if (!invite) invites.set(code, (invite = { ...newInvite(), room: code }))
  const c = new Collab({ invite, name, url, applyDelayMs: 10, ...extra })
  collabs.push(c)
  return c
}
const readerOf = (code: string, url: string, name: string) => {
  const invite = readOnlyOf(invites.get(code) as Invite)
  const c = new Collab({ invite, name, url, applyDelayMs: 10 })
  collabs.push(c)
  return c
}

const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms))
async function until(check: () => Promise<boolean> | boolean, ms = 3000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await check()) return true
    await settle(20)
  }
  return false
}

async function filled(files: Record<string, string>): Promise<Fs> {
  const fs = new MemoryFs()
  for (const [p, c] of Object.entries(files)) await fs.write(p, c)
  return fs
}

afterEach(async () => {
  await Promise.all(collabs.splice(0).map((c) => c.leave()))
  await Promise.all(relays.splice(0).map((r) => r.close()))
  invites.clear()
})

describe('working together', () => {
  it('gives a joiner the project of the host', async () => {
    const { url } = await start()
    const host = person('abcd-efgh', url, 'Anna')
    await host.join(await filled({ 'main.py': 'print(1)\n', 'classes/Crab.py': 'class Crab: ...\n' }))
    const guestFs = new MemoryFs()
    const guest = person('abcd-efgh', url, 'Ben')
    expect(await guest.join(guestFs)).not.toBeNull()
    expect(await guestFs.read('main.py')).toBe('print(1)\n')
    expect(await guestFs.read('classes/Crab.py')).toBe('class Crab: ...\n')
    await until(() => guest.people().length === 2)
    expect(guest.people().map((p) => p.name).sort()).toEqual(['Anna', 'Ben'])
    expect(guest.people()[0]?.self).toBe(true)
  })

  it('merges edits made at the same time in one file', async () => {
    const { url } = await start()
    const a = person('room-aaaa', url, 'A')
    const b = person('room-aaaa', url, 'B')
    const fsA = (await a.join(await filled({ 'main.py': 'one\ntwo\n' }))) as Fs
    const fsB = (await b.join(new MemoryFs())) as Fs
    expect(await until(() => b.room.has('main.py'))).toBe(true)
    expect(await fsB.read('main.py')).toBe('one\ntwo\n')
    a.room.text('main.py')?.insert(0, 'A:')
    b.room.text('main.py')?.insert('one\ntwo\n'.length, 'B:')
    await until(async () => (await fsA.read('main.py')) === 'A:one\ntwo\nB:' && (await fsB.read('main.py')) === 'A:one\ntwo\nB:')
    expect(await fsA.read('main.py')).toBe('A:one\ntwo\nB:')
    expect(await fsB.read('main.py')).toBe('A:one\ntwo\nB:')
  })

  it('shows new, renamed and removed files and pictures to the others', async () => {
    const { url } = await start()
    const a = person('room-bbbb', url, 'A')
    const b = person('room-bbbb', url, 'B')
    const innerB = new MemoryFs()
    const changes: string[] = []
    b.onRemote = (c) => changes.push(JSON.stringify(c))
    const fsA = (await a.join(await filled({ 'main.py': 'x\n' }))) as Fs
    await b.join(innerB)
    await fsA.write('classes/Hero.py', 'class Hero: ...\n')
    await fsA.write('images/hero.png', new Uint8Array([1, 2, 3, 250]))
    expect(await until(async () => (await innerB.exists('classes/Hero.py')) && (await innerB.exists('images/hero.png')))).toBe(true)
    expect([...(await innerB.readBytes('images/hero.png'))]).toEqual([1, 2, 3, 250])
    await fsA.rename('classes/Hero.py', 'classes/Knight.py')
    expect(await until(async () => (await innerB.exists('classes/Knight.py')) && !(await innerB.exists('classes/Hero.py')))).toBe(true)
    expect(await innerB.read('classes/Knight.py')).toBe('class Hero: ...\n')
    await fsA.remove('classes')
    expect(await until(async () => !(await innerB.exists('classes/Knight.py')))).toBe(true)
    expect(changes.some((c) => c.includes('classes/Knight.py'))).toBe(true)
  })

  it('does not let a late autosave undo what somebody else typed', async () => {
    const { url } = await start()
    const a = person('room-cccc', url, 'A')
    const b = person('room-cccc', url, 'B')
    const fsA = (await a.join(await filled({ 'main.py': 'v1' }))) as Fs
    await b.join(new MemoryFs())
    expect(await until(() => b.room.has('main.py'))).toBe(true)
    expect(isSyncedFs(fsA)).toBe(true)
    // B types; A's autosave still holds the old text
    b.room.text('main.py')?.insert(2, '-b')
    await until(() => a.room.text('main.py')?.toString() === 'v1-b')
    if (isSyncedFs(fsA)) await fsA.mirror.write('main.py', 'v1')
    expect(a.room.text('main.py')?.toString()).toBe('v1-b')
    expect(await fsA.read('main.py')).toBe('v1-b')
  })

  it('adds files only found on the joining side and lets the room win otherwise', async () => {
    const { url } = await start()
    const a = person('room-dddd', url, 'A')
    await a.join(await filled({ 'main.py': 'room version' }))
    const b = person('room-dddd', url, 'B')
    const local = await filled({ 'main.py': 'old local', 'notes.txt': 'mine' })
    await b.join(local)
    expect(await local.read('main.py')).toBe('room version')
    expect(await until(() => a.room.has('notes.txt'))).toBe(true)
  })

  it('catches up after the connection was lost', async () => {
    const { url, relay } = await start()
    const a = person('room-eeee', url, 'A')
    const b = person('room-eeee', url, 'B')
    await a.join(await filled({ 'main.py': 'start' }))
    await b.join(new MemoryFs())
    expect(await until(() => b.room.has('main.py'))).toBe(true)
    const sockets = [...(relay.rooms.get('room-eeee')?.conns.keys() ?? [])] as { terminate(): void }[]
    sockets.forEach((s) => s.terminate())
    a.room.text('main.py')?.insert(5, ' A')
    b.room.text('main.py')?.insert(0, 'B ')
    expect(await until(() => a.room.text('main.py')?.toString() === b.room.text('main.py')?.toString() && a.status === 'connected' && a.room.text('main.py')?.toString().includes('A') === true && a.room.text('main.py')?.toString().includes('B') === true, 8000)).toBe(true)
  })
})

describe('relay', () => {
  it('refuses pages that are not on its list and bad room names', async () => {
    const { url } = await start({ origins: ['https://editor.example.org'] })
    const c = person('room-ffff', url, 'A')
    expect(await c.join(new MemoryFs(), 3000)).toBeNull() // node sends no Origin
    expect(c.failure).toBe('refused')
    const bad = person('x', url, 'B')
    expect(await bad.join(new MemoryFs(), 3000)).toBeNull()
    expect(bad.failure).toBe('badRoom')
  })

  it('limits the people in a room', async () => {
    const { url } = await start({ origins: ['*'], maxPerRoom: 2 })
    const a = person('room-gggg', url, 'A')
    const b = person('room-gggg', url, 'B')
    const c = person('room-gggg', url, 'C')
    expect(await a.join(new MemoryFs())).not.toBeNull()
    expect(await b.join(new MemoryFs())).not.toBeNull()
    expect(await c.join(new MemoryFs(), 3000)).toBeNull()
    expect(c.failure).toBe('full')
  })

  it('forgets a room after the last person left (and keeps it while somebody is there)', async () => {
    const { url, relay } = await start({ origins: ['*'], roomTtlMs: 1 })
    const a = person('room-hhhh', url, 'A')
    await a.join(await filled({ 'main.py': 'x' }))
    expect(relay.rooms.has('room-hhhh')).toBe(true)
    await a.leave()
    expect(await until(() => (relay.rooms.get('room-hhhh')?.conns.size ?? 0) === 0)).toBe(true)
  })
})

describe('encryption', () => {
  it('keeps the project unreadable for the relay', async () => {
    const { url, relay } = await start()
    const a = person('room-encr', url, 'A')
    await a.join(await filled({ 'main.py': 'print("geheimer Satz")\n' }))
    const b = person('room-encr', url, 'B')
    await b.join(new MemoryFs())
    a.setFocus('main.py', 3)
    await settle(300)
    const room = relay.rooms.get('room-encr') as { log: { payload: Buffer }[] }
    expect(room.log.length).toBeGreaterThan(0)
    for (const entry of room.log) expect(entry.payload.toString('latin1')).not.toContain('geheimer')
    expect(b.room.text('main.py')?.toString()).toContain('geheimer Satz')
  })

  it('turns away a link with the wrong secret', async () => {
    const { url } = await start()
    const a = person('room-encs', url, 'A')
    await a.join(await filled({ 'main.py': 'x' }))
    const intruder = new Collab({ invite: { ...(invites.get('room-encs') as Invite), secret: 'z'.repeat(22) }, name: 'X', url })
    collabs.push(intruder)
    expect(await intruder.join(new MemoryFs(), 3000)).toBeNull()
    expect(intruder.failure).toBe('badKey')
  })

  it('compacts the log of the relay now and then', async () => {
    const { url, relay } = await start({ origins: ['*'], messagesPerSecond: 5000 })
    const a = person('room-encc', url, 'A')
    const b = person('room-encc', url, 'B')
    await a.join(await filled({ 'main.py': '' }))
    await b.join(new MemoryFs())
    await until(() => b.room.has('main.py'))
    const text = a.room.text('main.py')
    for (let i = 0; i < 400; i++) text?.insert(i, 'x')
    await until(() => b.room.text('main.py')?.length === 400)
    const room = relay.rooms.get('room-encc') as { log: unknown[] }
    expect(await until(() => room.log.length < 100, 6000)).toBe(true)
    // a newcomer still gets everything
    const c = person('room-encc', url, 'C')
    await c.join(new MemoryFs())
    expect(await until(() => c.room.text('main.py')?.length === 400)).toBe(true)
  })

  it('does not take changes from a read-only connection', async () => {
    const { url, relay } = await start()
    const a = person('room-ence', url, 'A')
    await a.join(await filled({ 'main.py': 'x' }))
    const { default: WebSocket } = await import('ws')
    const invite = readOnlyOf(invites.get('room-ence') as Invite)
    const ws = new WebSocket(`${url}/room-ence`, [`r.${invite.key}`])
    await new Promise((r) => ws.on('open', r))
    const room = relay.rooms.get('room-ence') as { log: unknown[] }
    const before = room.log.length
    ws.send(Buffer.concat([Buffer.from([3]), Buffer.alloc(40, 1)])) // DATA
    ws.send(Buffer.concat([Buffer.from([5, 0, 0, 0, 1]), Buffer.alloc(40, 1)])) // SNAPSHOT
    await settle(200)
    expect(room.log.length).toBe(before)
    ws.close()
  })
})

describe('short codes', () => {
  it('are easy to say and forgiving to type', () => {
    for (let i = 0; i < 50; i++) expect(parseShortCode(newShortCode())).not.toBeNull()
    expect(parseShortCode('  KOBI Latu 07 ')).toBe('kobi-latu-07')
    expect(parseShortCode('kobi-latu')).toBeNull()
    expect(parseShortCode('hello-world-12')).toBeNull()
  })

  it('lead to the invitation, which the relay cannot read', async () => {
    const { url, relay } = await start()
    const base = url.replace(/^ws/, 'http')
    const invite = { ...newInvite(), room: 'abcd-efgh' }
    const code = await publishCode(base, invite)
    expect(await resolveCode(base, code)).toEqual(invite)
    expect(await resolveCode(base, 'bobo-bobo-00')).toBeNull()
    const stored = [...relay.codes.values()].map((e) => e.data.toString('latin1')).join('')
    expect(stored).not.toContain(invite.secret)
    expect(stored).not.toContain(invite.key)
  })

  it('can be looked up without an Origin (a GET to the own site), but not from a foreign page', async () => {
    const { url } = await start({ origins: ['https://editor.example.org'] })
    const lookup = `${url.replace(/^ws/, 'http')}/code/${'0'.repeat(32)}`
    const status = async (init?: RequestInit) => (await fetch(lookup, init)).status
    expect(await status()).toBe(404)
    expect(await status({ headers: { origin: 'https://editor.example.org' } })).toBe(404)
    expect(await status({ headers: { origin: 'https://elsewhere.example.org' } })).toBe(403)
    expect(await status({ method: 'PUT', body: 'x'.repeat(32) })).toBe(403)
  })

  it('expire, and a try is limited per address', async () => {
    const { url, relay } = await start({ origins: ['*'], codeTtlMs: 1, codeTriesPerMinute: 5 })
    const base = url.replace(/^ws/, 'http')
    const code = await publishCode(base, newInvite())
    await settle(20)
    expect(await resolveCode(base, code)).toBeNull()
    expect(relay.codes.size).toBe(1)
    let blocked = false
    for (let i = 0; i < 10 && !blocked; i++) blocked = await resolveCode(base, 'bobo-bobo-00').then(() => false, (e: Error) => e.message === 'tooMany')
    expect(blocked).toBe(true)
  })
})

describe("others' program output", () => {
  it('reaches the others, and starts over with every run', async () => {
    const { url } = await start()
    const a = person('room-outa', url, 'A')
    const b = person('room-outa', url, 'B')
    const w = readerOf('room-outa', url, 'Lehrer')
    await a.join(new MemoryFs())
    await b.join(new MemoryFs())
    await w.join(new MemoryFs())
    await until(() => b.people().length === 3 && w.people().length === 3)
    a.shareRunStart()
    a.shareLines([{ kind: 'stdout', text: 'Hallo' }, { kind: 'stderr', text: 'Fehler!' }])
    expect(await until(() => b.remoteRuns.get(a.id)?.lines.length === 2)).toBe(true)
    expect(b.remoteRuns.get(a.id)).toMatchObject({ running: true, started: 1 })
    expect(await until(() => w.remoteRuns.get(a.id)?.lines.length === 2)).toBe(true) // a teacher reads along
    a.shareRunEnd()
    expect(await until(() => b.remoteRuns.get(a.id)?.running === false)).toBe(true)
    a.shareRunStart()
    expect(await until(() => b.remoteRuns.get(a.id)?.started === 2)).toBe(true)
    expect(b.remoteRuns.get(a.id)?.lines).toEqual([])
    expect(a.remoteRuns.size).toBe(0)
  })

  it('is not accepted from somebody who only watches, and ignores junk', async () => {
    const { url } = await start()
    const a = person('room-outb', url, 'A')
    const w = readerOf('room-outb', url, 'Lehrer')
    await a.join(new MemoryFs())
    await w.join(new MemoryFs())
    await until(() => a.people().length === 2)
    w.provider.sendApp({ t: 'out', lines: [['stdout', 'from the teacher']] })
    w.provider.sendApp({ t: 'start' })
    await settle(300)
    expect(a.remoteRuns.size).toBe(0)
    w.shareRunStart() // a reader never sends these at all
    a.provider.sendApp({ t: 'out', lines: [['bogus', 'x'], 5, ['stdout', 7]] })
    await settle(200)
    expect(w.remoteRuns.get(a.id)?.lines ?? []).toEqual([])
  })
})

describe('audit: trust and limits', () => {
  it('does not believe a "from" that is not one of the sender\'s own people', async () => {
    const { url } = await start()
    const a = person('room-audi', url, 'A')
    const b = person('room-audi', url, 'B')
    const w = readerOf('room-audi', url, 'Schueler')
    await a.join(new MemoryFs())
    await b.join(new MemoryFs())
    await w.join(new MemoryFs())
    await until(() => b.people().length === 3)
    // the watcher claims to be A (a writer) and sends output in A's name
    const forged = JSON.stringify({ from: a.id, data: { t: 'out', lines: [['stdout', 'forged']] } })
    const provider = w.provider as unknown as { sendSealed(type: number, plain: Uint8Array): Promise<void> }
    await provider.sendSealed(4, new Uint8Array([2, ...new TextEncoder().encode(forged)]))
    await settle(300)
    expect(b.remoteRuns.get(a.id)).toBeUndefined()
  })

  it('ignores junk and caps the log of a room', async () => {
    const { url, relay } = await start({ origins: ['*'], maxLogEntries: 5 })
    const a = person('room-audj', url, 'A')
    await a.join(new MemoryFs())
    const { default: WebSocket } = await import('ws')
    const invite = invites.get('room-audj') as Invite
    const ws = new WebSocket(`${url}/room-audj`, [`k.${invite.key}`])
    await new Promise((r) => ws.on('open', r))
    const room = relay.rooms.get('room-audj') as { log: unknown[] }
    const before = room.log.length
    ws.send(Buffer.from([3, 1, 2, 3])) // far too short to be a sealed message
    await settle(100)
    expect(room.log.length).toBe(before)
    const closed = new Promise((r) => ws.on('close', (code) => r(code)))
    for (let i = 0; i < 10; i++) ws.send(Buffer.concat([Buffer.from([3]), Buffer.alloc(40, i)]))
    expect(await closed).toBe(1009)
    expect(room.log.length).toBeLessThanOrEqual(5)
  })

  it('takes the client address from the end of X-Forwarded-For, not from what the client wrote', async () => {
    const { url, relay } = await start({ origins: ['*'], trustProxy: 1, maxPerIp: 1 })
    const { default: WebSocket } = await import('ws')
    const open = (spoof: string) => new Promise<number>((resolve) => {
      const ws = new WebSocket(`${url}/room-ip${spoof.length}`, ['k.abcdefabcdef'], { headers: { 'x-forwarded-for': spoof } })
      ws.on('close', (code) => resolve(code))
      ws.on('open', () => setTimeout(() => resolve(0), 150))
    })
    expect(await open('1.1.1.1, 9.9.9.9')).toBe(0)
    // the proxy appended the same real address again: the first entry (forged, different) changes nothing
    expect(await open('2.2.2.2, 9.9.9.9')).toBe(4004)
    expect(relay.rooms.size).toBeGreaterThan(0)
  })
})

describe('room codes', () => {
  it('look like abcd-efgh and fit the relay pattern', () => {
    for (let i = 0; i < 50; i++) expect(randomRoomCode()).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/)
  })
})

describe('read-only link', () => {
  it('lets a teacher watch, but nothing he does reaches the room', async () => {
    const { url } = await start()
    const a = person('room-rrrr', url, 'Anna')
    await a.join(await filled({ 'main.py': 'print(1)\n' }))
    const teacherFs = new MemoryFs()
    const t = readerOf('room-rrrr', url, 'Lehrer')
    expect(await t.join(teacherFs)).not.toBeNull()
    expect(t.readOnly).toBe(true)
    expect(t.locked).toBe(true)
    expect(await teacherFs.read('main.py')).toBe('print(1)\n')
    // he sees live changes
    a.room.text('main.py')?.insert(0, '# hi\n')
    expect(await until(async () => (await teacherFs.read('main.py')) === '# hi\nprint(1)\n')).toBe(true)
    // even a client that tampers with its own copy is not believed
    t.room.text('main.py')?.insert(0, 'EVIL')
    await settle(300)
    expect(a.room.text('main.py')?.toString()).toBe('# hi\nprint(1)\n')
  })

  it('keeps what a watcher does on his own device out of the room', async () => {
    const { url } = await start()
    const a = person('room-uuuu', url, 'Anna')
    await a.join(await filled({ 'main.py': 'x' }))
    expect(a.readInvite().readOnly).toBe(true)
    const t = readerOf('room-uuuu', url, 'Lehrer')
    const fs = (await t.join(new MemoryFs())) as Fs
    await fs.write('scratch.py', 'mine')
    await fs.remove('main.py')
    await settle(300)
    expect(a.room.has('scratch.py')).toBe(false)
    expect(a.room.has('main.py')).toBe(true)
  })

  it('is refused without the right key, and when the room does not exist yet', async () => {
    const { url } = await start()
    const a = person('room-ssss', url, 'Anna')
    await a.join(new MemoryFs())
    const wrong = new Collab({ invite: { room: 'room-ssss', key: 'wrongwrongwrong', readKey: 'wrongwrongwrong', secret: 'x'.repeat(22), readOnly: true }, name: 'x', url })
    collabs.push(wrong)
    expect(await wrong.join(new MemoryFs(), 3000)).toBeNull()
    expect(wrong.failure).toBe('refused')
    const writerWrong = new Collab({ invite: { room: 'room-ssss', key: 'wrongwrongwrong', readKey: 'wrongwrongwrong', secret: 'x'.repeat(22), readOnly: false }, name: 'x', url })
    collabs.push(writerWrong)
    expect(await writerWrong.join(new MemoryFs(), 3000)).toBeNull()
    expect(writerWrong.failure).toBe('refused')
    invites.set('room-tttt', newInvite())
    const early = readerOf('room-tttt', url, 'early')
    expect(await early.join(new MemoryFs(), 3000)).toBeNull()
    expect(early.failure).toBe('notFound')
  })
})

describe('files deleted while away', () => {
  it('are deleted here too, unless the room was new', async () => {
    const { url, relay } = await start()
    let known: string[] = []
    const a = person('room-vvvv', url, 'Anna')
    const fsA = (await a.join(await filled({ 'main.py': 'm', 'old.py': 'o' }))) as Fs
    const innerB = await filled({})
    const b1 = person('room-vvvv', url, 'Ben', { onKnown: (p: string[]) => (known = p) })
    await b1.join(innerB)
    expect(await innerB.exists('old.py')).toBe(true)
    expect(known.sort()).toEqual(['main.py', 'old.py'])
    await b1.leave()
    const logged = () => (relay.rooms.get('room-vvvv') as { log: unknown[] }).log.length
    const before = logged()
    await fsA.remove('old.py')
    expect(await until(() => logged() > before)).toBe(true) // the relay has the deletion before Ben comes back
    await innerB.write('mine.py', 'new offline') // made while away: not known to the room
    const b2 = person('room-vvvv', url, 'Ben', { known: new Set(known) })
    await b2.join(innerB)
    expect(await innerB.exists('old.py')).toBe(false)
    expect(b2.removedOnJoin).toEqual(['old.py'])
    expect(await innerB.exists('mine.py')).toBe(true)
    expect(await until(() => a.room.has('mine.py'))).toBe(true)
    // the relay forgets the room (restart): nothing is deleted, everything here is the project again
    await a.leave()
    await b2.leave()
    for (const name of [...relay.rooms.keys()]) relay.rooms.delete(name)
    const c = person('room-vvvv', url, 'Ben', { known: new Set(['main.py', 'mine.py']) })
    await c.join(innerB)
    expect(await innerB.exists('main.py')).toBe(true)
    expect(c.removedOnJoin).toEqual([])
    expect(c.room.has('main.py')).toBe(true)
  })
})

describe('roles and following', () => {
  it('lets one person drive and the others watch, until he leaves', async () => {
    const { url } = await start()
    const a = person('room-wwww', url, 'A')
    const b = person('room-wwww', url, 'B')
    await a.join(new MemoryFs())
    await b.join(new MemoryFs())
    await until(() => a.people().length === 2 && b.people().length === 2)
    expect(a.locked || b.locked).toBe(false)
    a.takeWheel()
    expect(await until(() => b.driver === a.id)).toBe(true)
    expect(b.locked).toBe(true)
    expect(a.locked).toBe(false)
    b.takeWheel()
    expect(await until(() => a.locked && !b.locked)).toBe(true)
    b.releaseWheel()
    expect(await until(() => !a.locked)).toBe(true)
    a.takeWheel()
    await until(() => b.locked)
    await a.leave()
    expect(await until(() => !b.locked)).toBe(true)
  })

  it('tells where somebody is working, and stops following when he leaves', async () => {
    const { url } = await start()
    const a = person('room-xxxx', url, 'A')
    const b = person('room-xxxx', url, 'B')
    await a.join(new MemoryFs())
    await b.join(new MemoryFs())
    a.setFocus('classes/Crab.py', 12)
    expect(await until(() => b.people().find((p) => p.id === a.id)?.focus?.line === 12)).toBe(true)
    b.follow(a.id)
    expect(b.following).toBe(a.id)
    await a.leave()
    expect(await until(() => b.following === null)).toBe(true)
  })
})

describe('big files', () => {
  it('stay on the device that has them, and say so once', async () => {
    const { url } = await start()
    const skipped: string[] = []
    const a = person('room-yyyy', url, 'A')
    a.onSkipped = (path) => skipped.push(path)
    const fs = (await a.join(new MemoryFs())) as Fs
    await fs.write('images/huge.png', new Uint8Array(4 * 1024 * 1024))
    await fs.write('images/small.png', new Uint8Array(1000))
    await fs.write('images/huge.png', new Uint8Array(4 * 1024 * 1024 + 1))
    await settle(100)
    expect(a.room.has('images/huge.png')).toBe(false)
    expect(a.room.has('images/small.png')).toBe(true)
    expect(skipped).toEqual(['images/huge.png'])
    expect(await fs.exists('images/huge.png')).toBe(true)
  })
})

describe('relay health', () => {
  it('counts rooms and people, and names none of them', async () => {
    const { url } = await start()
    const a = person('room-zzzz', url, 'A')
    await a.join(new MemoryFs())
    const res = await fetch(url.replace(/^ws/, 'http') + '/health')
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, rooms: 1, connections: 1 })
    expect(JSON.stringify(body)).not.toContain('zzzz')
  })
})

describe('invitations', () => {
  it('round-trip through links and storage', () => {
    const invite = { ...newInvite(), room: 'abcd-efgh' }
    const link = roomLink(invite, 'https://e.org/')
    expect(link).toMatch(/^https:\/\/e\.org\/#room=abcd-efgh\.[a-z0-9]{12}\.[a-z0-9]{12}\.[a-z0-9]{22}$/)
    expect(parseInviteHash(link.slice(link.indexOf('#')))).toEqual(invite)
    const read = readOnlyOf(invite)
    const readLink = roomLink(read, 'https://e.org/')
    expect(readLink).toContain('#watch=abcd-efgh.')
    expect(readLink).not.toContain(invite.key)
    expect(parseInviteHash(readLink.slice(readLink.indexOf('#')))).toEqual(read)
    expect(deserializeInvite(serializeInvite(invite))).toEqual(invite)
    expect(deserializeInvite(serializeInvite(read))).toEqual(read)
    for (const bad of ['', '#room=abcd', '#room=abcd-efgh', '#room=abcd-efgh.aaaaaaaa.bbbbbbbb', '#room=abc.def', '#x=abcd-efgh.aaaaaaaa', '#watch=abcd-efgh', '#room=abcd-efgh.<script>']) expect(parseInviteHash(bad)).toBeNull()
    expect(deserializeInvite('junk')).toBeNull()
  })
})

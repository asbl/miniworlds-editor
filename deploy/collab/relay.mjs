// Relay for the editor's "work together" mode (see docs/collab.md). It cannot read what it carries: the editor encrypts every
// message with a key that only lives in the invitation link. The relay keeps a log of the encrypted changes of each room in
// memory (a newcomer is sent the log), passes on short-lived messages (cursors, program output), and forgets a room some time
// after the last person left. Nothing is written to disk.
import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { WebSocketServer } from 'ws'

/**
 * Messages (first byte). Editor → relay: DATA (kept in the log, passed on), EPHEMERAL (passed on only; allowed for watchers),
 * SNAPSHOT + `upto` (replaces the log up to that number by one entry: the editor compacts its own log).
 * Relay → editor: DATA + number, EPHEMERAL + sender, SYNCED (the log is complete) + last number + count, LEFT + sender,
 * COMPACTED + upto.
 */
export const MSG = { data: 3, ephemeral: 4, snapshot: 5, synced: 6, left: 7, compacted: 8 }
const u32 = (n) => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n >>> 0)
  return b
}
/**
 * Close codes the editor understands (a browser cannot read the status of a refused upgrade, but it can read a close code).
 * 4001 room full · 4002 server full · 4003 refused (origin or key) · 4004 too many connections from one address · 4005 bad room name · 4006 no such room
 */
export const CLOSE = { full: 4001, serverFull: 4002, refused: 4003, tooMany: 4004, badRoom: 4005, notFound: 4006 }
const KEY_PATTERN = /^[a-z0-9]{6,32}$/i
const sameKey = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

/** What a connection offers in `Sec-WebSocket-Protocol`: `k.<key>` (write), `v.<key>` (the room's read key, set by writers), `r.<key>` (read only). */
function offered(header) {
  const out = { write: null, read: null, readOnly: null }
  for (const raw of String(header ?? '').split(',')) {
    const token = raw.trim()
    const [kind, key] = [token.slice(0, 2), token.slice(2)]
    if (!KEY_PATTERN.test(key)) continue
    if (kind === 'k.') out.write = key
    else if (kind === 'v.') out.read = key
    else if (kind === 'r.') out.readOnly = key
  }
  return out
}

export const ROOM_PATTERN = /^[a-z0-9]{4,12}(-[a-z0-9]{4,12}){0,3}$/

export const DEFAULTS = {
  /** Pages (origins) allowed to connect; a browser always sends its own. ["*"] switches the check off (local tests only). */
  origins: [],
  maxMessageBytes: 16 * 1024 * 1024,
  /** What the log of one room may hold (encrypted; the editors compact it now and then). */
  maxDocBytes: 48 * 1024 * 1024,
  maxPerRoom: 20,
  maxRooms: 500,
  maxPerIp: 30,
  /** Messages per second and connection (typing sends a few; a picture is one message). */
  messagesPerSecond: 60,
  roomTtlMs: 24 * 60 * 60 * 1000,
  /** Short codes (see docs/collab.md): how long one is valid, how many exist at once, and tries per address and minute. */
  codeTtlMs: 4 * 60 * 60 * 1000,
  maxCodes: 2000,
  codeTriesPerMinute: 30,
  /** Take the client address from X-Forwarded-For (only behind a reverse proxy you control). */
  trustProxy: false,
}

/** @param {Partial<typeof DEFAULTS>} options */
export function createRelay(options = {}) {
  const config = { ...DEFAULTS, ...options }
  /** @type {Map<string, {log: {seq: number, payload: Buffer, snapshot?: boolean}[], bytes: number, seq: number, nextConn: number, conns: Map<any, number>, emptySince: number | null, writeKey: string, readKey: string | null, readers: Set<any>}>} */
  const rooms = new Map()
  const started = Date.now()
  const perIp = new Map()

  /** Short code → what the editor stored under it (an encrypted invitation; the relay cannot read it). Gone after `codeTtlMs`. */
  const codes = new Map()
  const tries = new Map()
  const clientIp = (req) => {
    const forwarded = config.trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : ''
    return forwarded || req.socket.remoteAddress || '?'
  }
  const CODE_PATH = /^(?:\/collab)?\/code\/([a-f0-9]{32})$/

  const server = createServer((req, res) => {
    const origin = typeof req.headers.origin === 'string' && originAllowed(req.headers.origin) ? req.headers.origin : null
    // same-origin behind a proxy needs no header; a relay on its own address answers the pages it serves
    const cors = origin ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, PUT', 'access-control-allow-headers': 'content-type' } : {}
    const url = (req.url ?? '').split('?')[0]
    if (url === '/health' || url === '/collab/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors })
      let connections = 0
      for (const room of rooms.values()) connections += room.conns.size
      // counts only: neither room names nor keys leave the process
      res.end(JSON.stringify({ ok: true, rooms: rooms.size, connections, codes: codes.size, uptimeSeconds: Math.round((Date.now() - started) / 1000), memoryMb: Math.round(process.memoryUsage().rss / 1048576) }))
      return
    }
    const code = CODE_PATH.exec(url)
    if (code) {
      const id = code[1]
      if (req.method === 'OPTIONS') return void res.writeHead(204, cors).end()
      if (!origin && !config.origins.includes('*')) return void res.writeHead(403).end()
      // guessing codes is what this limit is for: every try counts, hit or miss
      const ip = clientIp(req)
      const minute = Math.floor(Date.now() / 60000)
      const mine = tries.get(ip)
      const count = mine && mine.minute === minute ? mine.count + 1 : 1
      tries.set(ip, { minute, count })
      if (count > config.codeTriesPerMinute) return void res.writeHead(429, cors).end()
      const known = codes.get(id)
      const alive = known && known.expires > Date.now() ? known : null
      if (req.method === 'GET') {
        if (!alive) return void res.writeHead(404, cors).end()
        return void res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store', ...cors }).end(alive.data)
      }
      if (req.method === 'PUT') {
        const chunks = []
        let size = 0
        req.on('data', (chunk) => {
          size += chunk.length
          if (size <= 2048) chunks.push(chunk)
        })
        req.on('end', () => {
          if (size > 2048 || size < 16) return void res.writeHead(413, cors).end()
          if (alive) return void res.writeHead(409, cors).end() // taken: the editor makes another one
          if (codes.size >= config.maxCodes) return void res.writeHead(503, cors).end()
          codes.set(id, { data: Buffer.concat(chunks), expires: Date.now() + config.codeTtlMs })
          res.writeHead(201, cors).end()
        })
        return
      }
      return void res.writeHead(405, cors).end()
    }
    res.writeHead(404).end()
  })
  const wss = new WebSocketServer({ noServer: true, maxPayload: config.maxMessageBytes })

  const originAllowed = (origin) => config.origins.includes('*') || (typeof origin === 'string' && config.origins.includes(origin))

  server.on('upgrade', (req, socket, head) => {
    const name = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname.split('/').filter(Boolean).pop() ?? '')
    const ip = clientIp(req)
    const keys = offered(req.headers['sec-websocket-protocol'])
    const origin = req.headers.origin
    // every refusal is a normal close with a code: the page can tell the person why
    const decide = () => {
      if (!ROOM_PATTERN.test(name)) return { code: CLOSE.badRoom }
      if (!originAllowed(origin)) return { code: CLOSE.refused }
      if ((perIp.get(ip) ?? 0) >= config.maxPerIp) return { code: CLOSE.tooMany }
      const room = rooms.get(name)
      if (!room) {
        if (keys.readOnly && !keys.write) return { code: CLOSE.notFound }
        if (!keys.write) return { code: CLOSE.refused }
        if (rooms.size >= config.maxRooms) return { code: CLOSE.serverFull }
        return { create: { writeKey: keys.write, readKey: keys.read } }
      }
      if (room.conns.size >= config.maxPerRoom) return { code: CLOSE.full }
      if (keys.write) {
        if (!sameKey(keys.write, room.writeKey)) return { code: CLOSE.refused }
        if (!room.readKey && keys.read) room.readKey = keys.read
        return { readOnly: false }
      }
      if (keys.readOnly && sameKey(keys.readOnly, room.readKey)) return { readOnly: true }
      return { code: CLOSE.refused }
    }
    const verdict = decide()
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (verdict.code) return ws.close(verdict.code, 'refused')
      join(ws, name, ip, verdict)
    })
  })

  function openRoom(name, key) {
    let room = rooms.get(name)
    if (room) return room
    room = { log: [], bytes: 0, seq: 0, nextConn: 1, conns: new Map(), emptySince: null, writeKey: key.writeKey, readKey: key.readKey, readers: new Set() }
    rooms.set(name, room)
    return room
  }

  function broadcast(room, message, except) {
    for (const ws of room.conns.keys()) if (ws !== except && ws.readyState === 1) ws.send(message)
  }

  function join(ws, name, ip, verdict) {
    ws.binaryType = 'nodebuffer'
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1)
    const room = openRoom(name, verdict.create)
    const readOnly = verdict.readOnly === true
    room.emptySince = null
    const cid = room.nextConn++
    room.conns.set(ws, cid)
    if (readOnly) room.readers.add(ws)
    let budget = config.messagesPerSecond
    const refill = setInterval(() => (budget = config.messagesPerSecond), 1000)

    // an oversized or broken message closes the connection (1009 / 1002); without a listener the error would take the process down
    ws.on('error', () => {})
    ws.on('message', (data) => {
      if (--budget < 0) return ws.close(1008, 'rate')
      const message = Buffer.isBuffer(data) ? data : Buffer.concat(Array.isArray(data) ? data : [Buffer.from(data)])
      if (message.length < 1) return
      const type = message[0]
      if (type === MSG.ephemeral) {
        // cursors, names, program output: anybody may send, nobody keeps it
        broadcast(room, Buffer.concat([Buffer.from([MSG.ephemeral]), u32(cid), message.subarray(1)]), ws)
      } else if (type === MSG.data && !readOnly) {
        const payload = message.subarray(1)
        const seq = ++room.seq
        room.log.push({ seq, payload })
        room.bytes += payload.length
        broadcast(room, Buffer.concat([Buffer.from([MSG.data]), u32(seq), payload]), ws)
        if (room.bytes > config.maxDocBytes) ws.close(1009, 'too big')
      } else if (type === MSG.snapshot && !readOnly && message.length > 5) {
        const upto = message.readUInt32BE(1)
        const first = room.log[0]
        if (upto > room.seq || (first && upto <= first.seq && first.snapshot)) return // from the future, or older than what is kept
        const snapshot = { seq: upto, payload: message.subarray(5), snapshot: true }
        room.log = [snapshot, ...room.log.filter((entry) => entry.seq > upto)]
        room.bytes = room.log.reduce((sum, entry) => sum + entry.payload.length, 0)
        broadcast(room, Buffer.concat([Buffer.from([MSG.compacted]), u32(upto)]), ws)
      }
    })

    ws.on('close', () => {
      clearInterval(refill)
      perIp.set(ip, Math.max(0, (perIp.get(ip) ?? 1) - 1))
      room.conns.delete(ws)
      room.readers.delete(ws)
      // the others drop this person's cursor at once
      broadcast(room, Buffer.concat([Buffer.from([MSG.left]), u32(cid)]), ws)
      if (room.conns.size === 0) room.emptySince = Date.now()
    })

    // greet: everything the room has, then "that was all"
    for (const entry of room.log) ws.send(Buffer.concat([Buffer.from([MSG.data]), u32(entry.seq), entry.payload]))
    ws.send(Buffer.concat([Buffer.from([MSG.synced]), u32(room.seq), u32(room.log.length)]))
  }

  const sweep = setInterval(() => {
    for (const [id, entry] of codes) if (entry.expires <= Date.now()) codes.delete(id)
    for (const [ip, entry] of tries) if (entry.minute < Math.floor(Date.now() / 60000) - 1) tries.delete(ip)
    for (const [name, room] of rooms) {
      if (room.emptySince !== null && Date.now() - room.emptySince > config.roomTtlMs) {
        rooms.delete(name)
      }
    }
  }, 60_000)
  sweep.unref()

  return {
    server,
    rooms,
    codes,
    listen: (port, host) => new Promise((resolve) => server.listen(port, host, () => resolve(server.address()))),
    close: () => {
      clearInterval(sweep)
      for (const ws of wss.clients) ws.terminate()
      return new Promise((resolve) => server.close(() => resolve()))
    },
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = process.env
  const relay = createRelay({
    origins: (env.COLLAB_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    trustProxy: env.COLLAB_TRUST_PROXY === '1',
    ...(env.COLLAB_MAX_ROOMS ? { maxRooms: Number(env.COLLAB_MAX_ROOMS) } : {}),
    ...(env.COLLAB_MAX_PER_ROOM ? { maxPerRoom: Number(env.COLLAB_MAX_PER_ROOM) } : {}),
    ...(env.COLLAB_ROOM_TTL_HOURS ? { roomTtlMs: Number(env.COLLAB_ROOM_TTL_HOURS) * 3600_000 } : {}),
  })
  if (relay.server && !(env.COLLAB_ORIGINS ?? '').trim()) console.warn('COLLAB_ORIGINS is empty: every connection will be refused. Set it to the editor address, e.g. https://editor.example.org')
  const address = await relay.listen(Number(env.PORT ?? 8787), env.HOST ?? '0.0.0.0')
  console.log(`collab relay listening on ${typeof address === 'object' && address ? address.port : address}`)
}

// Relay for the editor's "work together" mode (see docs/collab.md): speaks the y-websocket protocol, keeps one Yjs document per room
// in memory and forgets a room some time after the last person left. Nothing is written to disk.
import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { WebSocketServer } from 'ws'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1
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
  maxDocBytes: 48 * 1024 * 1024,
  maxPerRoom: 20,
  maxRooms: 500,
  maxPerIp: 30,
  /** Messages per second and connection (typing sends a few; a picture is one message). */
  messagesPerSecond: 60,
  roomTtlMs: 24 * 60 * 60 * 1000,
  /** Take the client address from X-Forwarded-For (only behind a reverse proxy you control). */
  trustProxy: false,
}

/** @param {Partial<typeof DEFAULTS>} options */
export function createRelay(options = {}) {
  const config = { ...DEFAULTS, ...options }
  /** @type {Map<string, {doc: Y.Doc, awareness: awarenessProtocol.Awareness, conns: Map<any, Set<number>>, emptySince: number | null, writeKey: string, readKey: string | null, readers: Set<any>}>} */
  const rooms = new Map()
  const started = Date.now()
  const perIp = new Map()

  const server = createServer((req, res) => {
    if (req.url === '/health' || req.url === '/collab/health') {
      // same-origin behind a proxy needs no header; a relay on its own address answers the pages it serves
      const cors = typeof req.headers.origin === 'string' && originAllowed(req.headers.origin) ? { 'access-control-allow-origin': req.headers.origin } : {}
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors })
      let connections = 0
      for (const room of rooms.values()) connections += room.conns.size
      // counts only: neither room names nor keys leave the process
      res.end(JSON.stringify({ ok: true, rooms: rooms.size, connections, uptimeSeconds: Math.round((Date.now() - started) / 1000), memoryMb: Math.round(process.memoryUsage().rss / 1048576) }))
      return
    }
    res.writeHead(404).end()
  })
  const wss = new WebSocketServer({ noServer: true, maxPayload: config.maxMessageBytes })

  const originAllowed = (origin) => config.origins.includes('*') || (typeof origin === 'string' && config.origins.includes(origin))

  server.on('upgrade', (req, socket, head) => {
    const name = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname.split('/').filter(Boolean).pop() ?? '')
    const forwarded = config.trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : ''
    const ip = forwarded || req.socket.remoteAddress || '?'
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
    const doc = new Y.Doc()
    const awareness = new awarenessProtocol.Awareness(doc)
    awareness.setLocalState(null)
    room = { doc, awareness, conns: new Map(), emptySince: null, writeKey: key.writeKey, readKey: key.readKey, readers: new Set() }
    const made = room
    doc.on('update', (update, origin) => {
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MESSAGE_SYNC)
      syncProtocol.writeUpdate(encoder, update)
      broadcast(made, encoding.toUint8Array(encoder), origin)
    })
    awareness.on('update', ({ added, updated, removed }, origin) => {
      const changed = added.concat(updated, removed)
      if (origin && made.conns.has(origin)) {
        const ids = made.conns.get(origin)
        added.forEach((id) => ids.add(id))
        removed.forEach((id) => ids.delete(id))
      }
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, changed))
      broadcast(made, encoding.toUint8Array(encoder), null)
    })
    rooms.set(name, room)
    return room
  }

  function broadcast(room, message, except) {
    for (const ws of room.conns.keys()) if (ws !== except && ws.readyState === 1) ws.send(message)
  }

  function join(ws, name, ip, verdict) {
    ws.binaryType = 'arraybuffer'
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1)
    const room = openRoom(name, verdict.create)
    const readOnly = verdict.readOnly === true
    room.emptySince = null
    room.conns.set(ws, new Set())
    if (readOnly) room.readers.add(ws)
    let budget = config.messagesPerSecond
    const refill = setInterval(() => (budget = config.messagesPerSecond), 1000)

    // an oversized or broken message closes the connection (1009 / 1002); without a listener the error would take the process down
    ws.on('error', () => {})
    ws.on('message', (data) => {
      if (--budget < 0) return ws.close(1008, 'rate')
      try {
        const decoder = decoding.createDecoder(new Uint8Array(data))
        const encoder = encoding.createEncoder()
        const type = decoding.readVarUint(decoder)
        if (type === MESSAGE_SYNC) {
          // a read-only connection may ask (sync step 1) but never tell (step 2, updates)
          if (readOnly && decoding.peekVarUint(decoder) !== 0) return
          encoding.writeVarUint(encoder, MESSAGE_SYNC)
          syncProtocol.readSyncMessage(decoder, encoder, room.doc, ws)
          if (encoding.length(encoder) > 1) ws.send(encoding.toUint8Array(encoder))
          if (Y.encodeStateAsUpdate(room.doc).byteLength > config.maxDocBytes) ws.close(1009, 'too big')
        } else if (type === MESSAGE_AWARENESS) {
          awarenessProtocol.applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(decoder), ws)
        }
      } catch {
        ws.close(1003, 'bad message')
      }
    })

    ws.on('close', () => {
      clearInterval(refill)
      perIp.set(ip, Math.max(0, (perIp.get(ip) ?? 1) - 1))
      const ids = room.conns.get(ws)
      room.conns.delete(ws)
      room.readers.delete(ws)
      if (ids && ids.size) awarenessProtocol.removeAwarenessStates(room.awareness, [...ids], null)
      if (room.conns.size === 0) room.emptySince = Date.now()
    })

    // greet: our state (sync step 1) and who is here
    const hello = encoding.createEncoder()
    encoding.writeVarUint(hello, MESSAGE_SYNC)
    syncProtocol.writeSyncStep1(hello, room.doc)
    ws.send(encoding.toUint8Array(hello))
    const states = room.awareness.getStates()
    if (states.size > 0) {
      const a = encoding.createEncoder()
      encoding.writeVarUint(a, MESSAGE_AWARENESS)
      encoding.writeVarUint8Array(a, awarenessProtocol.encodeAwarenessUpdate(room.awareness, [...states.keys()]))
      ws.send(encoding.toUint8Array(a))
    }
  }

  const sweep = setInterval(() => {
    for (const [name, room] of rooms) {
      if (room.emptySince !== null && Date.now() - room.emptySince > config.roomTtlMs) {
        room.doc.destroy()
        rooms.delete(name)
      }
    }
  }, 60_000)
  sweep.unref()

  return {
    server,
    rooms,
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

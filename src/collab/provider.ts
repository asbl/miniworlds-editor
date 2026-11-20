import * as Y from 'yjs'
import * as awarenessProtocol from 'y-protocols/awareness'
import { open, roomKey, seal } from './crypto'
import { FINAL_FAILURES, failureOfClose, type CollabFailure } from './shared'

/** The relay's messages (see deploy/collab/relay.mjs). */
const DATA = 3
const EPHEMERAL = 4
const SNAPSHOT = 5
const SYNCED = 6
const LEFT = 7
const COMPACTED = 8
/** Inside an ephemeral message. */
const KIND_AWARENESS = 1
const KIND_APP = 2
/** The log on the relay is compacted when it has grown by this much (bytes) or this many messages since the last time. */
const COMPACT_BYTES = 1024 * 1024
const COMPACT_MESSAGES = 300

const u32 = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255])
const readU32 = (a: Uint8Array, at: number) => ((a[at] as number) * 2 ** 24 + ((a[at + 1] as number) << 16) + ((a[at + 2] as number) << 8) + (a[at + 3] as number)) >>> 0
function join(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

export type CollabStatus = 'connecting' | 'connected' | 'offline'

interface Options {
  /** Base address of the relay (`wss://…/collab`); the room name is appended. */
  url: string
  room: string
  /** Sub-protocols that carry the keys (never part of the address, so they stay out of server logs). */
  protocols?: string[]
  /** What everything is encrypted with (from the invitation). */
  secret: string
  /** Somebody who only watches never sends changes. */
  readOnly?: boolean
  doc: Y.Doc
  awareness: awarenessProtocol.Awareness
  /** Tests bring their own. */
  socket?: typeof WebSocket
}

/**
 * Keeps a Yjs document and its awareness in step with the relay. Everything is encrypted here; the relay only keeps a log of
 * sealed changes and hands it to newcomers, who replay it and then send what the room lacks. Reconnects by itself; edits made
 * while the connection is down merge when it comes back, because the document is a CRDT.
 */
export class CollabProvider {
  status: CollabStatus = 'connecting'
  /** True after the log of the room was replayed (every connect starts over). */
  synced = false
  /** The log was empty when we joined: a new room. */
  roomWasEmpty = false
  /** Why the relay (or the network) turned us away, when it did. */
  failure: CollabFailure | null = null
  /** A message of another person's editor (program output, …): who sent it (their awareness id) and what. */
  onApp: (from: number, data: unknown) => void = () => {}
  private ws: WebSocket | null = null
  private attempt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private compactTimer: ReturnType<typeof setTimeout> | null = null
  private destroyed = false
  private listeners = new Set<() => void>()
  private readonly key: Promise<CryptoKey>
  /** Incoming messages are handled one after the other (decrypting is asynchronous; the order matters for "that was all"). */
  private chain: Promise<void> = Promise.resolve()
  /** While replaying: what the relay has, to find out what it lacks. */
  private shadow: Y.Doc | null = null
  private lastSeq = 0
  private sinceBytes = 0
  private sinceCount = 0
  /** Which awareness ids came through which connection of the relay (so that a person who leaves is removed at once). */
  private senders = new Map<number, Set<number>>()
  private applyingFrom: number | null = null
  private lastGreeting = 0

  private readonly onDoc = (update: Uint8Array, origin: unknown) => {
    if (origin === this || this.options.readOnly || !this.synced) return // what happened before the log was replayed goes up in one piece
    void this.sendSealed(DATA, update)
  }
  private readonly onAwareness = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === this) {
      if (this.applyingFrom !== null) {
        const ids = this.senders.get(this.applyingFrom) ?? new Set<number>()
        added.concat(updated).forEach((id) => ids.add(id))
        removed.forEach((id) => ids.delete(id))
        this.senders.set(this.applyingFrom, ids)
      }
      return
    }
    this.sendAwareness(added.concat(updated, removed))
  }
  private readonly onLeave = () => awarenessProtocol.removeAwarenessStates(this.options.awareness, [this.options.doc.clientID], 'unload')

  constructor(private options: Options) {
    this.key = roomKey(options.secret, options.room)
    options.doc.on('update', this.onDoc)
    options.awareness.on('update', this.onAwareness)
    if (typeof window !== 'undefined') window.addEventListener('pagehide', this.onLeave)
    this.connect()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  private change(status: CollabStatus, synced = this.synced): void {
    if (status === this.status && synced === this.synced) return
    this.status = status
    this.synced = synced
    this.listeners.forEach((l) => l())
  }

  /** Resolves true when the first sync is done; false after `ms` (the relay is not answering) or at once when it refuses. */
  whenSynced(ms: number): Promise<boolean> {
    if (this.synced) return Promise.resolve(true)
    if (this.failure && FINAL_FAILURES.has(this.failure)) return Promise.resolve(false)
    return new Promise((resolve) => {
      const done = (ok: boolean) => {
        clearTimeout(timer)
        off()
        resolve(ok)
      }
      const timer = setTimeout(() => done(false), ms)
      const off = this.subscribe(() => {
        if (this.synced) done(true)
        else if (this.failure && this.failure !== 'busy') done(false)
      })
    })
  }

  private connect(): void {
    if (this.destroyed) return
    this.change('connecting', false)
    const Socket = this.options.socket ?? WebSocket
    const ws = new Socket(`${this.options.url.replace(/\/+$/, '')}/${this.options.room}`, this.options.protocols)
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    this.chain = Promise.resolve()
    this.lastSeq = this.sinceBytes = this.sinceCount = 0
    this.senders.clear()
    this.shadow?.destroy()
    this.shadow = new Y.Doc()
    ws.onopen = () => {
      this.attempt = 0
      this.failure = null
      this.change('connected', false)
      this.sendAwareness([this.options.doc.clientID])
    }
    ws.onmessage = (event) => {
      const message = new Uint8Array(event.data as ArrayBuffer)
      this.chain = this.chain.then(() => this.handle(ws, message)).catch((error) => console.warn('collab: unreadable message', error))
    }
    ws.onclose = (event) => {
      if (this.ws !== ws) return
      const refused = failureOfClose(event.code)
      // refused for a reason; or never got through (network, proxy); or a connection that worked and dropped (just try again)
      this.failure = this.failure === 'badKey' ? 'badKey' : (refused ?? (this.synced ? null : 'network'))
      this.ws = null
      this.shadow?.destroy()
      this.shadow = null
      // the others' cursors are gone with the connection
      const others = [...this.options.awareness.getStates().keys()].filter((id) => id !== this.options.doc.clientID)
      awarenessProtocol.removeAwarenessStates(this.options.awareness, others, this)
      this.change('offline', false)
      this.listeners.forEach((l) => l())
      if (this.destroyed || (this.failure && FINAL_FAILURES.has(this.failure))) return
      // a full room or a busy server may open up: ask again, but not in a hurry
      const slow = this.failure === 'full' || this.failure === 'serverFull' || this.failure === 'tooMany'
      const wait = (slow ? 15_000 : Math.min(10_000, 500 * 2 ** this.attempt++)) * (0.7 + Math.random() * 0.6)
      this.timer = setTimeout(() => this.connect(), wait)
    }
    ws.onerror = () => {} // onclose follows
  }

  private async handle(ws: WebSocket, message: Uint8Array): Promise<void> {
    if (this.ws !== ws || message.length === 0 || this.failure === 'badKey') return
    const type = message[0]
    if (type === DATA && message.length > 5) {
      const seq = readU32(message, 1)
      let update: Uint8Array
      try {
        update = await open(await this.key, this.options.room, message.subarray(5))
      } catch {
        // not made with our key: the link is wrong (or somebody tampers); either way this room is not for us
        this.failure = 'badKey'
        ws.close(1000, 'key')
        return
      }
      if (this.ws !== ws) return
      this.lastSeq = Math.max(this.lastSeq, seq)
      this.sinceBytes += message.length
      this.sinceCount++
      Y.applyUpdate(this.options.doc, update, this)
      if (this.shadow) Y.applyUpdate(this.shadow, update)
      else this.maybeCompact()
    } else if (type === SYNCED && message.length >= 9) {
      this.lastSeq = Math.max(this.lastSeq, readU32(message, 1))
      this.roomWasEmpty = readU32(message, 5) === 0
      const shadow = this.shadow
      this.shadow = null
      // what we have and the room lacks (a new room: everything; after a reconnect: what was typed while away)
      const missing = shadow ? Y.encodeStateAsUpdate(this.options.doc, Y.encodeStateVector(shadow)) : null
      shadow?.destroy()
      this.change('connected', true)
      if (missing && missing.length > 2 && !this.options.readOnly) void this.sendSealed(DATA, missing)
      this.maybeCompact()
    } else if (type === EPHEMERAL && message.length > 5) {
      const cid = readU32(message, 1)
      let plain: Uint8Array
      try {
        plain = await open(await this.key, this.options.room, message.subarray(5))
      } catch {
        return
      }
      if (this.ws !== ws) return
      if (plain[0] === KIND_AWARENESS) {
        const fresh = !this.senders.has(cid)
        this.applyingFrom = cid
        try {
          awarenessProtocol.applyAwarenessUpdate(this.options.awareness, plain.subarray(1), this)
        } finally {
          this.applyingFrom = null
        }
        // somebody new: they do not know us yet (the relay keeps no cursors), so say hello once
        if (fresh && Date.now() - this.lastGreeting > 500) {
          this.lastGreeting = Date.now()
          this.sendAwareness([this.options.doc.clientID])
        }
      } else if (plain[0] === KIND_APP) {
        try {
          const body = JSON.parse(new TextDecoder().decode(plain.subarray(1))) as { from?: unknown; data?: unknown }
          if (typeof body.from === 'number') this.onApp(body.from, body.data)
        } catch {
          /* not for us */
        }
      }
    } else if (type === LEFT && message.length >= 5) {
      const ids = this.senders.get(readU32(message, 1))
      this.senders.delete(readU32(message, 1))
      if (ids) awarenessProtocol.removeAwarenessStates(this.options.awareness, [...ids], this)
    } else if (type === COMPACTED) {
      this.sinceBytes = this.sinceCount = 0
    }
  }

  private sendAwareness(ids: number[]): void {
    if (this.options.awareness.getLocalState() === null && !ids.includes(this.options.doc.clientID)) return
    void this.sendSealed(EPHEMERAL, join(new Uint8Array([KIND_AWARENESS]), awarenessProtocol.encodeAwarenessUpdate(this.options.awareness, ids)))
  }

  /** A short-lived message to the others (not kept anywhere, not part of the project). */
  sendApp(data: unknown): void {
    void this.sendSealed(EPHEMERAL, join(new Uint8Array([KIND_APP]), new TextEncoder().encode(JSON.stringify({ from: this.options.doc.clientID, data }))))
  }

  private inflight = new Set<Promise<void>>()
  private sendChain: Promise<void> = Promise.resolve()

  /** Resolves when everything handed to the relay so far has been sent (a newcomer who asks right after will get it). */
  async flushed(): Promise<void> {
    while (this.inflight.size > 0) await Promise.all([...this.inflight])
  }

  private sendSealed(type: number, plain: Uint8Array, upto?: number): Promise<void> {
    // one after the other: messages reach the others in the order they were made (a run's start before its output)
    const task = this.sendChain.then(() => this.seal(type, plain, upto))
    this.sendChain = task.catch(() => {})
    this.inflight.add(task)
    void task.finally(() => this.inflight.delete(task))
    return task
  }

  private async seal(type: number, plain: Uint8Array, upto?: number): Promise<void> {
    const ws = this.ws
    if (!ws || ws.readyState !== 1) return
    try {
      const sealed = await seal(await this.key, this.options.room, plain)
      if (this.ws === ws && ws.readyState === 1) ws.send(upto === undefined ? join(new Uint8Array([type]), sealed) : join(new Uint8Array([type]), u32(upto), sealed))
    } catch (error) {
      console.warn('collab: could not send', error)
    }
  }

  /** The relay's log grows with every change; now and then one of the writers replaces the old part by the current state. */
  private maybeCompact(): void {
    if (this.options.readOnly || this.compactTimer !== null || (this.sinceBytes < COMPACT_BYTES && this.sinceCount < COMPACT_MESSAGES)) return
    // everybody notices at about the same time: whoever is first (after a random wait) does it, the others are told
    this.compactTimer = setTimeout(() => {
      this.compactTimer = null
      if (this.sinceBytes < COMPACT_BYTES && this.sinceCount < COMPACT_MESSAGES) return
      const upto = this.lastSeq
      this.sinceBytes = this.sinceCount = 0
      void this.sendSealed(SNAPSHOT, Y.encodeStateAsUpdate(this.options.doc), upto)
    }, Math.random() * 1500)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    if (this.timer) clearTimeout(this.timer)
    if (this.compactTimer) clearTimeout(this.compactTimer)
    awarenessProtocol.removeAwarenessStates(this.options.awareness, [this.options.doc.clientID], 'leave')
    this.options.doc.off('update', this.onDoc)
    this.options.awareness.off('update', this.onAwareness)
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', this.onLeave)
    this.shadow?.destroy()
    this.ws?.close()
    this.ws = null
    this.listeners.clear()
  }
}

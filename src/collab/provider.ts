import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { FINAL_FAILURES, failureOfClose, type CollabFailure } from './shared'

const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1
const SYNC_STEP2 = 1

export type CollabStatus = 'connecting' | 'connected' | 'offline'

interface Options {
  /** Base address of the relay (`wss://…/collab`); the room name is appended. */
  url: string
  room: string
  /** Sub-protocols that carry the keys (never part of the address, so they stay out of server logs). */
  protocols?: string[]
  doc: Y.Doc
  awareness: awarenessProtocol.Awareness
  /** Tests bring their own. */
  socket?: typeof WebSocket
}

/**
 * Keeps a Yjs document and its awareness in step with the relay (y-websocket protocol). Reconnects by itself; edits made
 * while the connection is down merge when it comes back, because the document is a CRDT.
 */
export class CollabProvider {
  status: CollabStatus = 'connecting'
  /** True after the relay has told us everything it knows (every connect starts over). */
  synced = false
  /** Why the relay (or the network) turned us away, when it did. */
  failure: CollabFailure | null = null
  private ws: WebSocket | null = null
  private attempt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private destroyed = false
  private listeners = new Set<() => void>()
  private readonly onDoc = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return
    const e = encoding.createEncoder()
    encoding.writeVarUint(e, MESSAGE_SYNC)
    syncProtocol.writeUpdate(e, update)
    this.send(encoding.toUint8Array(e))
  }
  private readonly onAwareness = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === this) return
    const e = encoding.createEncoder()
    encoding.writeVarUint(e, MESSAGE_AWARENESS)
    encoding.writeVarUint8Array(e, awarenessProtocol.encodeAwarenessUpdate(this.options.awareness, added.concat(updated, removed)))
    this.send(encoding.toUint8Array(e))
  }
  private readonly onLeave = () => awarenessProtocol.removeAwarenessStates(this.options.awareness, [this.options.doc.clientID], 'unload')

  constructor(private options: Options) {
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
    ws.onopen = () => {
      this.attempt = 0
      this.failure = null
      this.change('connected', false)
      const e = encoding.createEncoder()
      encoding.writeVarUint(e, MESSAGE_SYNC)
      syncProtocol.writeSyncStep1(e, this.options.doc)
      ws.send(encoding.toUint8Array(e))
      const local = this.options.awareness.getLocalState()
      if (local !== null) {
        const a = encoding.createEncoder()
        encoding.writeVarUint(a, MESSAGE_AWARENESS)
        encoding.writeVarUint8Array(a, awarenessProtocol.encodeAwarenessUpdate(this.options.awareness, [this.options.doc.clientID]))
        ws.send(encoding.toUint8Array(a))
      }
    }
    ws.onmessage = (event) => {
      try {
        const decoder = decoding.createDecoder(new Uint8Array(event.data as ArrayBuffer))
        const type = decoding.readVarUint(decoder)
        if (type === MESSAGE_SYNC) {
          const e = encoding.createEncoder()
          encoding.writeVarUint(e, MESSAGE_SYNC)
          const step = syncProtocol.readSyncMessage(decoder, e, this.options.doc, this)
          if (encoding.length(e) > 1) ws.send(encoding.toUint8Array(e))
          if (step === SYNC_STEP2 && !this.synced) this.change('connected', true)
        } else if (type === MESSAGE_AWARENESS) {
          awarenessProtocol.applyAwarenessUpdate(this.options.awareness, decoding.readVarUint8Array(decoder), this)
        }
      } catch (error) {
        console.warn('collab: unreadable message', error)
      }
    }
    ws.onclose = (event) => {
      if (this.ws !== ws) return
      const refused = failureOfClose(event.code)
      // refused for a reason; or never got through (network, proxy); or a connection that worked and dropped (just try again)
      this.failure = refused ?? (this.synced ? null : 'network')
      this.ws = null
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

  private send(message: Uint8Array<ArrayBuffer>): void {
    if (this.ws && this.ws.readyState === 1) this.ws.send(message)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    if (this.timer) clearTimeout(this.timer)
    awarenessProtocol.removeAwarenessStates(this.options.awareness, [this.options.doc.clientID], 'leave')
    this.options.doc.off('update', this.onDoc)
    this.options.awareness.off('update', this.onAwareness)
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', this.onLeave)
    this.ws?.close()
    this.ws = null
    this.listeners.clear()
  }
}

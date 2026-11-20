import { Prec, type Extension } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { Awareness } from 'y-protocols/awareness'
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next'
import { isTextPath } from '../project/search'
import type { Fs, FileEntry } from '../workspace'
import { normalizePath } from '../workspace/types'
import { CollabProvider, type CollabStatus } from './provider'
import { CollabRoom } from './room'
import { shrinkableType, shrinkImage } from './shrink'
import {
  cleanName,
  LINE_KINDS,
  MAX_REMOTE_LINES,
  MAX_SHARED_BYTES,
  MAX_SHARED_TOTAL,
  readOnlyOf,
  type CollabFailure,
  type Invite,
  type Person,
  type RemoteChange,
  type RemoteLine,
  type RemoteRun,
  type SyncedFs,
} from './shared'

export { cleanName, isSyncedFs, MAX_NAME, randomRoomCode, type Person, type RemoteChange, type SyncedFs } from './shared'

const COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#008080', '#9a6324', '#800000', '#808000', '#000075']
const LIGHT = (hex: string) => `${hex}33`

/**
 * One operation at a time: other people's changes arrive while the editor saves, and the browser file system fails a read of a
 * file that is being replaced at that moment.
 */
export function serialized(fs: Fs): Fs {
  let tail: Promise<unknown> = Promise.resolve()
  const queue = <T>(op: () => Promise<T>): Promise<T> => {
    const result = tail.then(op, op)
    tail = result.catch(() => {})
    return result
  }
  return {
    list: () => queue(() => fs.list()),
    read: (p) => queue(() => fs.read(p)),
    readBytes: (p) => queue(() => fs.readBytes(p)),
    exists: (p) => queue(() => fs.exists(p)),
    write: (p, c) => queue(() => fs.write(p, c)),
    remove: (p) => queue(() => fs.remove(p)),
    rename: (a, b) => queue(() => fs.rename(a, b)),
  }
}

export interface CollabOptions {
  invite: Invite
  name: string
  /** Base address of the relay (`wss://…/collab`). */
  url: string
  socket?: typeof WebSocket
  applyDelayMs?: number
  /** The files the room had when this project was last connected (null: first time). */
  known?: Set<string> | null
  /** The room's file list changed: remember it for the next time. */
  onKnown?: (paths: string[]) => void
}

/** What the editor needs to show a shared file (kept free of Yjs types so that the editor code does not load Yjs). */
export interface EditorSource {
  text(path: string): string | undefined
  extensions(path: string): Extension[] | null
}

/** One person's link to a shared project: the room, the connection, and a file system that stays in step with both. */
export class Collab {
  readonly room = new CollabRoom()
  readonly awareness = new Awareness(this.room.doc)
  readonly provider: CollabProvider
  readonly invite: Invite
  readonly readOnly: boolean
  /** Called after other people's changes reached the file system. */
  onRemote: (change: RemoteChange) => void = () => {}
  /** A file is too big to share: it stays on this device. */
  onSkipped: (path: string, bytes: number) => void = () => {}
  /** A picture was made smaller for sharing (the original stays on this device until the project joins again). */
  onShrunk: (path: string, before: number, after: number) => void = () => {}
  /** Files that were deleted by others while this project was away, and so were deleted here when it joined again. */
  removedOnJoin: string[] = []
  readonly skipped = new Map<string, number>()
  /** The short code made for this session in this window, and when the relay forgets it. */
  shortCode: { code: string; until: number } | null = null
  /** What the others' programs print (by their awareness id); only kept while they are in the room. */
  readonly remoteRuns = new Map<number, RemoteRun>()
  private fs: Fs | null = null
  private pending = { written: new Set<string>(), removed: new Set<string>(), replaced: new Set<string>() }
  private timer: ReturnType<typeof setTimeout> | null = null
  private knownTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private followed: number | null = null
  private listeners = new Set<() => void>()
  private focusKey = ''

  constructor(private options: CollabOptions) {
    this.invite = options.invite
    this.readOnly = options.invite.readOnly
    const color = COLORS[this.room.doc.clientID % COLORS.length] as string
    this.awareness.setLocalStateField('user', { name: cleanName(options.name), color, colorLight: LIGHT(color), readOnly: this.readOnly })
    const protocols = this.readOnly ? [`r.${options.invite.key}`] : [`k.${options.invite.key}`, `v.${options.invite.readKey}`]
    this.provider = new CollabProvider({ url: options.url, room: options.invite.room, protocols, secret: options.invite.secret, readOnly: this.readOnly, doc: this.room.doc, awareness: this.awareness, socket: options.socket })
    const emit = () => {
      // somebody who leaves is no longer followed (and no longer drives)
      if (this.followed !== null && !this.awareness.getStates().has(this.followed)) this.followed = null
      for (const id of this.remoteRuns.keys()) if (!this.awareness.getStates().has(id)) this.remoteRuns.delete(id)
      this.listeners.forEach((l) => l())
    }
    this.provider.onApp = (from, data) => this.onApp(from, data)
    this.provider.subscribe(emit)
    this.awareness.on('change', emit)
    this.room.meta.observe(emit)
    this.room.files.observeDeep((events, tr) => {
      this.scheduleKnown()
      if (tr.local) return
      for (const event of events) {
        if (event.target === this.room.files) {
          for (const [key, change] of (event as unknown as { keys: Map<string, { action: string }> }).keys) {
            if (change.action === 'delete') this.queue('removed', key)
            else this.queue('written', key, change.action === 'update')
          }
        } else if (typeof event.path[0] === 'string') this.queue('written', event.path[0])
      }
    })
    this.room.bin.observe((event, tr) => {
      this.scheduleKnown()
      if (tr.local) return
      for (const [key, change] of event.keys) {
        if (change.action === 'delete') this.queue('removed', key)
        else this.queue('written', key, change.action === 'update')
      }
    })
  }

  // ---- file changes of the others -----------------------------------------------------------------------------------

  private queue(kind: 'written' | 'removed', path: string, replaced = false): void {
    const { written, removed, replaced: again } = this.pending
    if (kind === 'written') {
      removed.delete(path)
      written.add(path)
      if (replaced) again.add(path)
    } else {
      written.delete(path)
      removed.add(path)
    }
    if (this.timer === null) this.timer = setTimeout(() => void this.apply(), this.options.applyDelayMs ?? 200)
  }

  private async apply(): Promise<void> {
    this.timer = null
    const fs = this.fs
    if (!fs) return // still joining: what arrived stays queued until `join` is through
    const change: RemoteChange = { written: [...this.pending.written], removed: [...this.pending.removed], replaced: [...this.pending.replaced] }
    this.pending = { written: new Set(), removed: new Set(), replaced: new Set() }
    if (this.disposed) return
    for (const path of change.removed) await fs.remove(path).catch(() => {})
    for (const path of change.written) {
      const text = this.room.text(path)
      const bytes = text ? undefined : this.room.bin.get(path)
      if (text) await fs.write(path, text.toString()).catch(() => {})
      else if (bytes) await fs.write(path, bytes).catch(() => {})
    }
    if (!this.disposed) this.onRemote(change)
  }

  private scheduleKnown(): void {
    if (!this.options.onKnown || this.knownTimer !== null || this.disposed) return
    this.knownTimer = setTimeout(() => {
      this.knownTimer = null
      if (!this.disposed) this.options.onKnown?.(this.room.paths())
    }, 1000)
  }

  // ---- joining ----------------------------------------------------------------------------------------------------

  /** Why joining failed (the relay's reason, or "network"). */
  get failure(): CollabFailure | null {
    return this.provider.failure
  }

  /** The bytes of the room (what a person who joins has to download). */
  private sharedBytes(): number {
    let sum = 0
    for (const text of this.room.files.values()) sum += text.length
    for (const bytes of this.room.bin.values()) sum += bytes.byteLength
    return sum
  }

  /**
   * What goes into the room for this file: big pictures made smaller, files that are still too big (alone or together with the
   * rest) not at all (they stay on this device; a note for the person, once per file). Null: do not share.
   */
  private async prepare(path: string, content: string | Uint8Array): Promise<string | Uint8Array | null> {
    let data = content
    if (typeof data !== 'string' && shrinkableType(path)) {
      const small = await shrinkImage(path, data)
      if (small) {
        this.onShrunk(path, data.byteLength, small.byteLength)
        data = small
      }
    }
    const bytes = typeof data === 'string' ? data.length : data.byteLength
    const mine = this.room.readBytes(path)?.byteLength ?? 0
    if (bytes <= MAX_SHARED_BYTES && this.sharedBytes() - mine + bytes <= MAX_SHARED_TOTAL) {
      this.skipped.delete(path)
      return data
    }
    if (!this.skipped.has(path)) this.onSkipped(path, bytes)
    this.skipped.set(path, bytes)
    return null
  }

  /**
   * Wait for the relay's state, then bring the file system and the room together: the room's files win; a file that exists
   * only here is deleted when the room had it at the last connection (somebody removed it), and otherwise added to the room.
   * Null when the relay did not let us in (see `failure`).
   */
  async join(plain: Fs, timeoutMs = 8000): Promise<SyncedFs | null> {
    if (!(await this.provider.whenSynced(timeoutMs))) return null
    const fs = serialized(plain)
    const roomWasEmpty = this.room.isEmpty()
    await this.room.writeInto(fs)
    const local = (await fs.list()).filter((e) => e.kind === 'file' && !this.room.has(e.path))
    if (!this.readOnly) {
      for (const { path } of local) {
        // an empty room is a new one (the relay forgot the old): nothing was deleted, everything here is the project
        if (!roomWasEmpty && this.options.known?.has(path)) {
          await fs.remove(path).catch(() => {})
          this.removedOnJoin.push(path)
          continue
        }
        const content = await this.prepare(path, isTextPath(path) ? await fs.read(path) : await fs.readBytes(path))
        if (content !== null) this.room.set(path, content)
      }
    }
    await this.provider.flushed() // what this person brought is in the room before the next one asks for it
    this.fs = fs
    if (this.timer === null && (this.pending.written.size > 0 || this.pending.removed.size > 0)) this.timer = setTimeout(() => void this.apply(), 0)
    this.options.onKnown?.(this.room.paths())
    return this.syncedFs(fs)
  }

  private syncedFs(inner: Fs): SyncedFs {
    const room = this.room
    const dec = new TextDecoder()
    const readOnly = this.readOnly
    const prepare = (path: string, content: string | Uint8Array) => this.prepare(path, content)
    const mirror: Fs = {
      list: () => inner.list(),
      read: (p) => this.read(inner, p),
      readBytes: (p) => this.readBytes(inner, p),
      exists: (p) => inner.exists(p),
      remove: (p) => inner.remove(p),
      rename: (from, to) => inner.rename(from, to),
      // typing already reached the room through the editor; what autosave writes may be a moment older than the room
      async write(path, content) {
        const text = room.text(normalizePath(path))
        await inner.write(path, text ? text.toString() : content)
      },
    }
    return {
      mirror,
      list: (): Promise<FileEntry[]> => inner.list(),
      read: (p) => this.read(inner, p),
      readBytes: (p) => this.readBytes(inner, p),
      exists: (p) => inner.exists(p),
      // somebody who only watches keeps whatever he does on his own device: nothing of it reaches the room
      async write(path, content) {
        await inner.write(path, content)
        if (readOnly) return
        const shared = await prepare(normalizePath(path), typeof content === 'string' || !isTextPath(path) ? content : dec.decode(content))
        if (shared !== null) room.set(normalizePath(path), shared)
      },
      async remove(path) {
        await inner.remove(path)
        if (!readOnly) room.remove(normalizePath(path))
      },
      async rename(from, to) {
        await inner.rename(from, to)
        if (!readOnly) room.rename(normalizePath(from), normalizePath(to))
      },
    }
  }

  private async read(inner: Fs, path: string): Promise<string> {
    return this.room.text(normalizePath(path))?.toString() ?? inner.read(path)
  }

  private async readBytes(inner: Fs, path: string): Promise<Uint8Array> {
    return this.room.readBytes(normalizePath(path)) ?? inner.readBytes(path)
  }

  // ---- people -----------------------------------------------------------------------------------------------------

  get status(): CollabStatus {
    return this.provider.status
  }

  get id(): number {
    return this.room.doc.clientID
  }

  people(): Person[] {
    const out: Person[] = []
    for (const [id, state] of this.awareness.getStates()) {
      const s = state as { user?: { name?: string; color?: string; readOnly?: boolean }; focus?: { path: string; line: number } }
      if (s.user?.name) out.push({ id, name: s.user.name, color: s.user.color ?? '#888', self: id === this.id, readOnly: s.user.readOnly === true, focus: s.focus ?? null })
    }
    return out.sort((a, b) => Number(b.self) - Number(a.self) || a.name.localeCompare(b.name))
  }

  setName(name: string): void {
    const current = (this.awareness.getLocalState() as { user?: { color: string; colorLight: string } } | null)?.user
    this.awareness.setLocalStateField('user', { ...current, name: cleanName(name), readOnly: this.readOnly })
  }

  /** Where this person is working (so that others can follow). */
  setFocus(path: string, line: number): void {
    const key = `${path}:${line}`
    if (key === this.focusKey) return
    this.focusKey = key
    this.awareness.setLocalStateField('focus', { path, line })
  }

  /** Follow somebody: the editor shows what that person is working on. null stops. */
  follow(id: number | null): void {
    this.followed = id !== null && id !== this.id && this.awareness.getStates().has(id) ? id : null
    this.listeners.forEach((l) => l())
  }

  get following(): number | null {
    return this.followed
  }

  // ---- what the others' programs print --------------------------------------------------------------------------------

  /** This person started the program (the others' view of this person's output starts over). */
  shareRunStart(): void {
    if (!this.readOnly) this.provider.sendApp({ t: 'start' })
  }

  shareRunEnd(): void {
    if (!this.readOnly) this.provider.sendApp({ t: 'end' })
  }

  shareLines(lines: { kind: string; text: string }[]): void {
    if (!this.readOnly && lines.length > 0) this.provider.sendApp({ t: 'out', lines: lines.map((l) => [l.kind, l.text]) })
  }

  private onApp(from: number, data: unknown): void {
    if (from === this.id || typeof data !== 'object' || data === null) return
    const message = data as { t?: unknown; lines?: unknown }
    // somebody who only watches does not run programs for the others
    const sender = this.awareness.getStates().get(from) as { user?: { readOnly?: boolean } } | undefined
    if (!sender || sender.user?.readOnly) return
    let run = this.remoteRuns.get(from)
    if (message.t === 'start') {
      this.remoteRuns.set(from, { lines: [], running: true, started: (run?.started ?? 0) + 1, unseen: 0, nextLine: 0 })
    } else if (message.t === 'end') {
      if (run) run.running = false
    } else if (message.t === 'out' && Array.isArray(message.lines)) {
      if (!run) this.remoteRuns.set(from, (run = { lines: [], running: false, started: 1, unseen: 0, nextLine: 0 }))
      for (const row of message.lines.slice(0, 200)) {
        if (!Array.isArray(row) || typeof row[0] !== 'string' || typeof row[1] !== 'string' || !LINE_KINDS.has(row[0])) continue
        run.lines.push({ id: run.nextLine++, kind: row[0] as RemoteLine['kind'], text: row[1].slice(0, 5000) })
        run.unseen++
      }
      if (run.lines.length > MAX_REMOTE_LINES) run.lines.splice(0, run.lines.length - MAX_REMOTE_LINES)
    } else return
    this.listeners.forEach((l) => l())
  }

  markRunSeen(id: number): void {
    const run = this.remoteRuns.get(id)
    if (run && run.unseen > 0) {
      run.unseen = 0
      this.listeners.forEach((l) => l())
    }
  }

  clearRun(id: number): void {
    const run = this.remoteRuns.get(id)
    if (run) {
      run.lines = []
      run.unseen = 0
      this.listeners.forEach((l) => l())
    }
  }

  // ---- pair programming: one person drives, the others watch (and can take the wheel) -------------------------------

  /** The person who drives, if there is one still in the room. */
  get driver(): number | null {
    const id = this.room.meta.get('driver')
    return id !== undefined && this.awareness.getStates().has(id) ? id : null
  }

  takeWheel(): void {
    if (!this.readOnly) this.room.meta.set('driver', this.id)
  }

  releaseWheel(): void {
    if (!this.readOnly) this.room.meta.delete('driver')
  }

  /** This person cannot type now: only watching, or somebody else drives. */
  get locked(): boolean {
    return this.readOnly || (this.driver !== null && this.driver !== this.id)
  }

  /** The invitation for somebody who should only watch. */
  readInvite(): Invite {
    return readOnlyOf(this.invite)
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  // ---- editor ---------------------------------------------------------------------------------------------------------

  editorSource(): EditorSource {
    return {
      text: (path) => this.room.text(path)?.toString(),
      extensions: (path) => {
        const text = this.room.text(path)
        // the shared text is the truth; its own undo only takes back one's own typing, so it comes before the ordinary history keys
        return text ? [yCollab(text, this.awareness), Prec.highest(keymap.of(yUndoManagerKeymap))] : null
      },
    }
  }

  /** Stop: others see you leave. Pending remote changes are still written, so that nothing the others typed is lost. */
  async leave(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      await this.apply()
    }
    this.disposed = true
    if (this.knownTimer !== null) clearTimeout(this.knownTimer)
    this.listeners.clear()
    this.provider.destroy()
    this.awareness.destroy()
    this.room.destroy()
  }
}

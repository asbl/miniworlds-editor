import type { Fs } from '../workspace'
import { isTextPath } from '../project/search'
import type { ErrorNote } from '../runtime/explain'

/** What the session needs from the editor widget (CodeMirror in the app, a fake in tests). */
export interface Surface {
  show(path: string, text: string): void
  clear(): void
  forget(path: string): void
  reveal(line: number, column: number, length: number): void
  /** Mark the failing line of the file currently shown (null clears), with the message under it when given. */
  markError(line: number | null, note?: ErrorNote | null): void
  clearErrors(): void
}

export interface SessionState {
  open: readonly string[]
  active: string | null
  /** Paths with edits that are not yet in the file system. */
  dirty: ReadonlySet<string>
}

/**
 * Open tabs, unsaved edits and autosave for one project. UI-framework free:
 * components subscribe and render `state`.
 */
export class Session {
  state: SessionState = { open: [], active: null, dirty: new Set() }
  private latest = new Map<string, string>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private listeners = new Set<() => void>()
  private editListeners = new Set<() => void>()

  constructor(
    readonly fs: Fs,
    private surface: Surface,
    private autosaveMs = 500,
    /** Where autosave writes to, when that differs from `fs` (a shared project: typing is already in the room). */
    private saver: Fs = fs,
  ) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  private set(patch: Partial<SessionState>): void {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((l) => l())
  }

  /** Text as the user sees it: the unsaved edit if there is one, otherwise the file. */
  async readText(path: string): Promise<string> {
    return this.latest.get(path) ?? (await this.fs.read(path))
  }

  /** Notified on every edit in the editor (e.g. for auto-reload). */
  subscribeEdits(listener: () => void): () => void {
    this.editListeners.add(listener)
    return () => void this.editListeners.delete(listener)
  }

  /** Files were changed from outside the editor (restore): tell what reacts to edits (class diagram, hints). */
  externalChange(): void {
    this.editListeners.forEach((l) => l())
  }

  /** Called by the editor on every change. */
  edit(path: string, text: string): void {
    this.editListeners.forEach((l) => l())
    this.latest.set(path, text)
    if (!this.state.dirty.has(path)) this.set({ dirty: new Set(this.state.dirty).add(path) })
    clearTimeout(this.timers.get(path))
    this.timers.set(path, setTimeout(() => void this.save(path), this.autosaveMs))
  }

  async save(path: string): Promise<void> {
    const text = this.latest.get(path)
    if (text === undefined) return
    clearTimeout(this.timers.get(path))
    this.timers.delete(path)
    await this.saver.write(path, text)
    // an edit that arrived while writing keeps the path dirty
    if (this.latest.get(path) === text) {
      this.latest.delete(path)
      const dirty = new Set(this.state.dirty)
      dirty.delete(path)
      this.set({ dirty })
    }
  }

  async saveAll(): Promise<void> {
    await Promise.all([...this.latest.keys()].map((p) => this.save(p)))
  }

  async open(path: string, at?: { line: number; column: number; length: number }): Promise<void> {
    if (!this.state.open.includes(path)) this.set({ open: [...this.state.open, path] })
    await this.show(path)
    if (at && isTextPath(path)) this.surface.reveal(at.line, at.column, at.length)
  }

  async show(path: string): Promise<void> {
    if (isTextPath(path)) this.surface.show(path, await this.readText(path))
    else this.surface.clear()
    this.set({ active: path })
  }

  async close(path: string): Promise<void> {
    await this.save(path)
    this.surface.forget(path)
    const idx = this.state.open.indexOf(path)
    const open = this.state.open.filter((p) => p !== path)
    this.set({ open })
    if (this.state.active !== path) return
    const next = open[Math.min(idx, open.length - 1)]
    if (next) await this.show(next)
    else {
      this.surface.clear()
      this.set({ active: null })
    }
  }

  /** Write a file from outside the editor (generated import, replace-all) and refresh it if open. */
  async writeText(path: string, text: string): Promise<void> {
    clearTimeout(this.timers.get(path))
    this.timers.delete(path)
    this.latest.delete(path)
    await this.fs.write(path, text)
    const dirty = new Set(this.state.dirty)
    dirty.delete(path)
    this.set({ dirty })
    await this.reload(path)
  }

  /** Re-read an open text file from disk (after it changed on disk). */
  async reload(path: string): Promise<void> {
    if (!this.state.open.includes(path)) return
    this.surface.forget(path)
    if (this.state.active === path) await this.show(path)
  }

  /** A file or folder was removed: close its tabs and drop pending edits. */
  async removed(path: string): Promise<void> {
    for (const p of this.state.open.filter((o) => o === path || o.startsWith(path + '/'))) {
      clearTimeout(this.timers.get(p))
      this.timers.delete(p)
      this.latest.delete(p)
      const dirty = new Set(this.state.dirty)
      dirty.delete(p)
      this.set({ dirty })
      await this.close(p)
    }
  }

  /** A file or folder moved: keep its tab and any unsaved edit under the new name. */
  async moved(from: string, to: string): Promise<void> {
    const rename = (p: string) => (p === from || p.startsWith(from + '/') ? to + p.slice(from.length) : p)
    const affected = this.state.open.filter((p) => rename(p) !== p)
    if (affected.length === 0) return
    const pending = new Map<string, string>()
    for (const p of affected) {
      const text = this.latest.get(p)
      if (text !== undefined) pending.set(rename(p), text)
      clearTimeout(this.timers.get(p))
      this.timers.delete(p)
      this.latest.delete(p)
      this.surface.forget(p)
    }
    const wasActive = this.state.active
    const dirty = new Set([...this.state.dirty].filter((p) => !affected.includes(p)))
    this.set({ open: this.state.open.map(rename), dirty, active: wasActive ? rename(wasActive) : null })
    for (const [path, text] of pending) this.edit(path, text)
    if (wasActive && affected.includes(wasActive)) await this.show(rename(wasActive))
  }

  dispose(): void {
    this.timers.forEach((t) => clearTimeout(t))
    this.timers.clear()
    this.listeners.clear()
    this.editListeners.clear()
  }
}

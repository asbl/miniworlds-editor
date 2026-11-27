import * as Y from 'yjs'
import { isTextPath } from '../project/search'
import type { Fs } from '../workspace'
import { simpleDiff } from './diff'

/** Marks changes that come from this editor's own file system (as opposed to the network or the typing in the editor). */
export const FS_ORIGIN = Symbol('collab-fs')

/**
 * CodeMirror counts every line break as one character, `Y.Text` counts `\r\n` as two: with a `\r` in the shared text, the
 * editor binding puts every edit in the wrong place. Shared text therefore only ever has `\n`.
 */
const unixLines = (text: string) => text.replace(/\r\n?/g, '\n')

/**
 * The shared project: text files as `Y.Text` (so that two people typing in the same file merge), everything else as bytes.
 * Paths are the project-relative paths of the file system; the shared document knows nothing about folders.
 */
export class CollabRoom {
  readonly doc = new Y.Doc()
  readonly files = this.doc.getMap<Y.Text>('files')
  readonly bin = this.doc.getMap<Uint8Array>('bin')
  /** Small shared settings: who drives (pair programming). */
  readonly meta = this.doc.getMap<number>('meta')
  private enc = new TextEncoder()

  has(path: string): boolean {
    return this.files.has(path) || this.bin.has(path)
  }

  isEmpty(): boolean {
    return this.files.size === 0 && this.bin.size === 0
  }

  text(path: string): Y.Text | undefined {
    return this.files.get(path)
  }

  /**
   * Remove every `\r` from shared text that already has some (a room filled by an older version of the editor). Call before an
   * editor is bound to it. A `\r` of a `\r\n` is only deleted, so that two people doing this at once do no harm.
   */
  normalize(path?: string): void {
    this.doc.transact(() => {
      for (const key of path === undefined ? [...this.files.keys()] : [path]) {
        const text = this.files.get(key)
        const content = text?.toString()
        if (!text || !content?.includes('\r')) continue
        // from the end, so that the positions still to come stay valid
        for (let i = content.length - 1; i >= 0; i--) {
          if (content[i] !== '\r') continue
          text.delete(i, 1)
          if (content[i + 1] !== '\n') text.insert(i, '\n') // a lone one is shown as a line break: keep what people see
        }
      }
    }, FS_ORIGIN)
  }

  paths(): string[] {
    return [...this.files.keys(), ...this.bin.keys()].sort()
  }

  readBytes(path: string): Uint8Array | undefined {
    const text = this.files.get(path)
    if (text) return this.enc.encode(text.toString())
    return this.bin.get(path)
  }

  /** Make a file's content `content` (a no-op when it already is). Text goes in as a minimal edit, not a replacement. */
  set(path: string, content: string | Uint8Array): void {
    this.doc.transact(() => {
      if (typeof content === 'string' && isTextPath(path)) {
        this.bin.delete(path)
        this.normalize(path)
        const after = unixLines(content)
        const existing = this.files.get(path)
        if (!existing) return void this.files.set(path, new Y.Text(after))
        const before = existing.toString()
        if (before === after) return
        const d = simpleDiff(before, after)
        if (d.remove) existing.delete(d.index, d.remove)
        if (d.insert) existing.insert(d.index, d.insert)
        return
      }
      const bytes = typeof content === 'string' ? this.enc.encode(content) : content
      this.files.delete(path)
      const old = this.bin.get(path)
      if (old && old.length === bytes.length && old.every((b, i) => b === bytes[i])) return
      this.bin.set(path, bytes)
    }, FS_ORIGIN)
  }

  /** Remove a file, or every file below a folder. */
  remove(path: string): void {
    this.doc.transact(() => {
      for (const map of [this.files, this.bin] as Y.Map<unknown>[]) for (const key of [...map.keys()]) if (key === path || key.startsWith(path + '/')) map.delete(key)
    }, FS_ORIGIN)
  }

  rename(from: string, to: string): void {
    this.doc.transact(() => {
      for (const key of [...this.files.keys()]) {
        if (key !== from && !key.startsWith(from + '/')) continue
        const text = this.files.get(key)?.toString() ?? ''
        this.files.delete(key)
        this.files.set(to + key.slice(from.length), new Y.Text(unixLines(text)))
      }
      for (const key of [...this.bin.keys()]) {
        if (key !== from && !key.startsWith(from + '/')) continue
        const bytes = this.bin.get(key) as Uint8Array
        this.bin.delete(key)
        this.bin.set(to + key.slice(from.length), bytes)
      }
    }, FS_ORIGIN)
  }

  /** Put every file of a file system into the room (only for a room that is empty: otherwise the contents would double). */
  async seedFrom(fs: Fs): Promise<number> {
    const entries = (await fs.list()).filter((e) => e.kind === 'file')
    const loaded: [string, string | Uint8Array][] = []
    for (const { path } of entries) loaded.push([path, isTextPath(path) ? await fs.read(path) : await fs.readBytes(path)])
    this.doc.transact(() => {
      for (const [path, content] of loaded) this.set(path, content)
    }, FS_ORIGIN)
    return loaded.length
  }

  /**
   * Make a file system show what the room contains: files of the room are written, files only on this side stay (and are
   * added to the room by the caller). Returns the paths that were written.
   */
  async writeInto(fs: Fs): Promise<string[]> {
    const written: string[] = []
    for (const path of this.paths()) {
      const text = this.files.get(path)
      if (text) {
        const now = text.toString()
        if ((await fs.exists(path).catch(() => false)) && (await fs.read(path).catch(() => null)) === now) continue
        await fs.write(path, now)
      } else {
        await fs.write(path, this.bin.get(path) as Uint8Array)
      }
      written.push(path)
    }
    return written
  }

  destroy(): void {
    this.doc.destroy()
  }
}

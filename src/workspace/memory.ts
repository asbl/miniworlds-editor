import { type Fs, type FileEntry, normalizePath } from './types'

/** In-memory file system: fallback when OPFS is missing, and the test double. */
export class MemoryFs implements Fs {
  private files = new Map<string, Uint8Array>()
  private enc = new TextEncoder()
  private dec = new TextDecoder()

  async list(): Promise<FileEntry[]> {
    const entries = new Map<string, FileEntry>()
    for (const path of this.files.keys()) {
      const parts = path.split('/')
      for (let i = 1; i < parts.length; i++) {
        const dir = parts.slice(0, i).join('/')
        entries.set(dir, { path: dir, kind: 'dir' })
      }
      entries.set(path, { path, kind: 'file' })
    }
    return [...entries.values()].sort((a, b) => a.path.localeCompare(b.path))
  }

  async read(path: string): Promise<string> {
    return this.dec.decode(await this.readBytes(path))
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const data = this.files.get(normalizePath(path))
    if (!data) throw new Error(`Datei nicht gefunden: ${path}`)
    return data
  }

  async write(path: string, content: string | Uint8Array): Promise<void> {
    const data = typeof content === 'string' ? this.enc.encode(content) : content
    this.files.set(normalizePath(path), data)
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(normalizePath(path))
  }

  async remove(path: string): Promise<void> {
    const key = normalizePath(path)
    if (this.files.delete(key)) return
    // directory: remove everything below it
    let removed = false
    for (const file of [...this.files.keys()]) {
      if (file.startsWith(key + '/')) {
        this.files.delete(file)
        removed = true
      }
    }
    if (!removed) throw new Error(`Nicht gefunden: ${path}`)
  }

  async rename(from: string, to: string): Promise<void> {
    const src = normalizePath(from)
    const dst = normalizePath(to)
    const data = this.files.get(src)
    if (!data) throw new Error(`Datei nicht gefunden: ${from}`)
    if (this.files.has(dst)) throw new Error(`Existiert bereits: ${to}`)
    this.files.delete(src)
    this.files.set(dst, data)
  }
}

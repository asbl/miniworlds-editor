import { type Fs, type FileEntry, normalizePath } from './types'

/** Browser file system (Origin Private File System), rooted at one project directory. */
export class OpfsFs implements Fs {
  constructor(private root: FileSystemDirectoryHandle) {}

  /** A project's folder (`projects/<name>`), or with another `area` the folder of that name in it (`history/<name>`). */
  static async open(projectName: string, area = 'projects'): Promise<OpfsFs> {
    const base = await navigator.storage.getDirectory()
    const parent = await base.getDirectoryHandle(area, { create: true })
    return new OpfsFs(await parent.getDirectoryHandle(projectName, { create: true }))
  }

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory
  }

  private async dirOf(path: string, create: boolean): Promise<[FileSystemDirectoryHandle, string]> {
    const parts = normalizePath(path).split('/')
    const name = parts.pop() as string
    let dir = this.root
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create })
    return [dir, name]
  }

  async list(): Promise<FileEntry[]> {
    const out: FileEntry[] = []
    const walk = async (dir: FileSystemDirectoryHandle, prefix: string) => {
      for await (const [name, handle] of dir.entries()) {
        const path = prefix + name
        if (handle.kind === 'directory') {
          out.push({ path, kind: 'dir' })
          await walk(handle as FileSystemDirectoryHandle, path + '/')
        } else {
          out.push({ path, kind: 'file' })
        }
      }
    }
    await walk(this.root, '')
    return out.sort((a, b) => a.path.localeCompare(b.path))
  }

  async read(path: string): Promise<string> {
    return new TextDecoder().decode(await this.readBytes(path))
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const [dir, name] = await this.dirOf(path, false)
    const file = await (await dir.getFileHandle(name)).getFile()
    return new Uint8Array(await file.arrayBuffer())
  }

  async write(path: string, content: string | Uint8Array): Promise<void> {
    const [dir, name] = await this.dirOf(path, true)
    const handle = await dir.getFileHandle(name, { create: true })
    const writable = await handle.createWritable()
    await writable.write(content as FileSystemWriteChunkType)
    await writable.close()
  }

  async exists(path: string): Promise<boolean> {
    try {
      const [dir, name] = await this.dirOf(path, false)
      await dir.getFileHandle(name)
      return true
    } catch {
      return false
    }
  }

  async remove(path: string): Promise<void> {
    const [dir, name] = await this.dirOf(path, false)
    await dir.removeEntry(name, { recursive: true })
  }

  async rename(from: string, to: string): Promise<void> {
    if (await this.exists(to)) throw new Error(`Existiert bereits: ${to}`)
    await this.write(to, await this.readBytes(from))
    await this.remove(from)
  }
}

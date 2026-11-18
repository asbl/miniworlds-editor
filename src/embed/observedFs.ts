import type { Fs } from '../workspace'

/** Reports every change made through it (the editor's autosave writes through the file system). */
export function observeFs(fs: Fs, changed: () => void): Fs {
  return {
    list: () => fs.list(),
    read: (p) => fs.read(p),
    readBytes: (p) => fs.readBytes(p),
    exists: (p) => fs.exists(p),
    async write(path, content) {
      await fs.write(path, content)
      changed()
    },
    async remove(path) {
      await fs.remove(path)
      changed()
    },
    async rename(from, to) {
      await fs.rename(from, to)
      changed()
    },
  }
}

import type { Fs } from '../workspace'

/** Reports every change made through it, with the paths concerned (the editor's autosave writes through the file system). */
export function observeFs(fs: Fs, changed: (paths: string[]) => void): Fs {
  return {
    list: () => fs.list(),
    read: (p) => fs.read(p),
    readBytes: (p) => fs.readBytes(p),
    exists: (p) => fs.exists(p),
    async write(path, content) {
      await fs.write(path, content)
      changed([path])
    },
    async remove(path) {
      await fs.remove(path)
      changed([path])
    },
    async rename(from, to) {
      await fs.rename(from, to)
      changed([from, to])
    },
  }
}

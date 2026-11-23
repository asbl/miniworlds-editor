import type { Fs } from '../workspace'

/** Snapshot viewers can run/export; all editing paths share this guard. */
export function previewFs(raw: Fs, locked: () => boolean): Fs {
  const refuse = () => { if (locked()) throw new Error('Diese Vorschau ist schreibgeschützt.') }
  const fs: Fs = {
    list: () => raw.list(), read: p => raw.read(p), readBytes: p => raw.readBytes(p), exists: p => raw.exists(p),
    async write(path, content) {
      if (locked()) {
        const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
        if (await raw.exists(path)) {
          const old = await raw.readBytes(path)
          if (old.length === bytes.length && old.every((b, i) => b === bytes[i])) return
        }
        refuse()
      }
      await raw.write(path, content)
    },
    async remove(path) { refuse(); await raw.remove(path) },
    async rename(from, to) { refuse(); await raw.rename(from, to) },
    exclusive: action => action(fs),
  }
  return fs
}

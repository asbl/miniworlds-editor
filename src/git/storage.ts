import type LightningFS from '@isomorphic-git/lightning-fs'
import type { Fs } from '../workspace'

/** Git data lives beside snapshots, never in exported/runnable project files. */
export function gitStorage(fs: Fs, id = 'default'): LightningFS.IDB & { unlink(inode: number): Promise<void>; seal(): void } {
  const prefix = `git/storage/${id}/`
  let sealed = false
  return {
    seal() { sealed = true },
    async saveSuperblock(value: unknown) {
      if (sealed) return
      await fs.write(prefix + 'tree', JSON.stringify(value, (_, v) => v instanceof Map ? { $map: [...v] } : v))
    },
    async loadSuperblock() {
      if (!(await fs.exists(prefix + 'tree'))) return undefined as unknown as LightningFS.SuperBlock
      return JSON.parse(await fs.read(prefix + 'tree'), (_, v) => v?.$map ? new Map(v.$map) : v)
    },
    async readFile(inode: number) { return fs.readBytes(prefix + inode) },
    async writeFile(inode: number, data: Uint8Array) { if (sealed) return; await fs.write(prefix + inode, data) },
    async unlink(inode: number) { if (sealed) return; if (await fs.exists(prefix + inode)) await fs.remove(prefix + inode) },
    async wipe() {
      for (const entry of await fs.list()) if (entry.kind === 'file' && entry.path.startsWith(prefix)) await fs.remove(entry.path)
    },
    async close() {},
  }
}

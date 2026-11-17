import { MemoryFs } from './memory'
import { OpfsFs } from './opfs'
import type { Workspace } from './types'

export type { Workspace, Fs, FileEntry } from './types'
export { MemoryFs } from './memory'

/** Browser workspace: OPFS when available, otherwise in-memory (data is lost on reload). */
export async function createBrowserWorkspace(projectName = 'default'): Promise<Workspace> {
  if (OpfsFs.isSupported()) {
    try {
      return { kind: 'opfs', fs: await OpfsFs.open(projectName) }
    } catch (error) {
      console.warn('OPFS nicht nutzbar, Fallback auf Speicher', error)
    }
  }
  return { kind: 'memory', fs: new MemoryFs() }
}

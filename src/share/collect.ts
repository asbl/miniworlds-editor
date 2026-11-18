import { loadMeta } from '../miniworlds/meta'
import type { Provenance } from '../miniworlds/provenance'
import { detectKind } from '../project/manifest'
import { loadSettings, type KeyValue } from '../project/settings'
import type { Workspace } from '../workspace'

/** Everything the share dialog needs to know about the open project. */
export interface ShareContext {
  name: string
  files: Record<string, Uint8Array>
  provenance: Provenance
  miniworlds: string | null
  packages: string[]
}

export async function collectShareContext(workspace: Workspace, name: string, store: KeyValue): Promise<ShareContext> {
  const entries = await workspace.fs.list()
  const files: Record<string, Uint8Array> = {}
  for (const e of entries) if (e.kind === 'file') files[e.path] = await workspace.fs.readBytes(e.path)
  const settings = await loadSettings(workspace.fs, detectKind(entries), name, store)
  return { name, files, provenance: (await loadMeta(workspace.fs)).images ?? {}, miniworlds: settings.miniworlds, packages: settings.packages }
}

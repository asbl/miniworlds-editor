import { hashText } from '../history/history'
import { isTextPath } from '../project/search'
import type { Fs } from '../workspace'
import { decode, encode } from './client'
import type { BackendConnection } from './projects'

export interface ServerCommit { hash: string; date: string; message: string }
export interface ShareState { status: 'pending' | 'approved' | 'rejected' | 'revoked' | null; slug: string | null; declaration_text: string }

const WINDOW_MS = 60 * 1000

/** Every automatic save is a version on the server. Show the newest of each minute, the oldest one and all other entries (restores). */
export function thin(commits: ServerCommit[]): ServerCommit[] {
  let kept = Infinity
  return commits.filter((commit, index) => {
    const time = Date.parse(commit.date)
    if (index < commits.length - 1 && commit.message.startsWith('Speichern am ') && kept - time < WINDOW_MS) return false
    kept = time
    return true
  })
}

export async function serverHistory(connection: BackendConnection) {
  const data = await connection.client.json<{ available: boolean; commits: ServerCommit[]; paused?: boolean }>('/api/play/history?limit=2000')
  return { commits: thin(data.commits), paused: !!data.paused }
}

/** Text files as text; other files as size and fingerprint, so that a change is visible. */
const describe = (path: string, bytes: Uint8Array) =>
  isTextPath(path) ? new TextDecoder().decode(bytes) : `(${bytes.length} Bytes · ${hashText(encode(bytes))})`

export async function serverVersion(connection: BackendConnection, hash: string, local: Fs) {
  const { save } = await connection.client.json<{ save: { source: string; db: string | null; files?: Record<string, string> | null } }>(`/api/play/history/${hash}`)
  const old: Record<string, string> = {}
  if (save.files) for (const [path, content] of Object.entries(save.files)) old[path] = describe(path, decode(content))
  else {
    old['main.py'] = save.source
    if (save.db) old['save.db'] = describe('save.db', decode(save.db))
  }
  const current: Record<string, string> = {}
  for (const entry of await local.list()) if (entry.kind === 'file') current[entry.path] = describe(entry.path, await local.readBytes(entry.path))
  return { old, current }
}

/** The server replaces its project with the old version; reopening the project then loads it. Needs a saved project. */
export async function restoreVersion(connection: BackendConnection, hash: string) {
  await connection.sync()
  if (connection.dirty) throw new Error('Bitte den Projektstand zuerst erfolgreich speichern.')
  await connection.client.json(`/api/play/restore/${hash}?base_revision=${connection.revision}`, 'POST', {})
}

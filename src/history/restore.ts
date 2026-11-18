import type { Fs } from '../workspace'
import { isTextPath } from '../project/search'
import type { Session } from '../ui/session'
import type { History } from './history'

/** Files that hold the state of the miniworlds view (start setup, tasks): changing them is no change of the program. */
const NOT_PROGRAM = new Set(['miniworlds.json', 'greenfoot.json'])

/** The project's text files as the user sees them (unsaved typing included). */
export async function readTexts(fs: Fs, session: Pick<Session, 'readText'> | null): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const entry of await fs.list()) {
    if (entry.kind !== 'file' || !isTextPath(entry.path) || NOT_PROGRAM.has(entry.path)) continue
    out[entry.path] = session ? await session.readText(entry.path) : await fs.read(entry.path)
  }
  return out
}

interface Deps {
  fs: Fs
  session: Pick<Session, 'readText' | 'writeText' | 'removed' | 'externalChange'>
  history: History
}

/** Put one file back as it was. The state before is remembered first, so the restore itself can be undone. */
export async function restoreFile({ fs, session, history }: Deps, snapshotId: string, path: string): Promise<void> {
  const texts = await history.read(snapshotId)
  if (!Object.hasOwn(texts, path)) throw new Error('file-not-in-snapshot')
  await history.record(await readTexts(fs, session), 'before-restore')
  await session.writeText(path, texts[path] as string)
  session.externalChange()
}

/** Put every text file back: changed ones are rewritten, missing ones come back, files that did not exist then are removed. */
export async function restoreAll({ fs, session, history }: Deps, snapshotId: string): Promise<{ written: number; removed: number }> {
  const texts = await history.read(snapshotId)
  const now = await readTexts(fs, session)
  await history.record(now, 'before-restore')
  let written = 0
  let removed = 0
  for (const [path, text] of Object.entries(texts)) {
    if (Object.hasOwn(now, path) && now[path] === text) continue
    await session.writeText(path, text)
    written++
  }
  for (const path of Object.keys(now)) {
    if (Object.hasOwn(texts, path)) continue
    await fs.remove(path)
    await session.removed(path)
    removed++
  }
  session.externalChange()
  return { written, removed }
}

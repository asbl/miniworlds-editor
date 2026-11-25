import type { Fs } from '../workspace'
import { parseCheck, type Check } from '../tasks/checks'
import { parseProvenance, type Provenance } from './provenance'
import type { Op } from './journal'

export const META_FILE = 'miniworlds.json'
/** Name used by the old web client (and earlier versions of this editor); still read, replaced on the next save. */
export const LEGACY_META_FILE = 'greenfoot.json'

/** Per-project data of the miniworlds view. Same shape as the old web client wrote, so its projects open unchanged. */
export interface MiniworldsMeta {
  journal: Op[]
  tasks: string[]
  tasksDone: Record<string, boolean>
  /** One automatic check per task (null: tick it by hand). Same length as `tasks`. */
  checks?: (Check | null)[]
  /** The tasks are the editor's own ideas for this program (not a template's or a teacher's tasks). */
  suggested?: boolean
  /** Where each project image came from (library, drawn, uploaded); sharing needs it. */
  images?: Provenance
}

export const emptyMeta = (): MiniworldsMeta => ({ journal: [], tasks: [], tasksDone: {} })

const OPS = new Set(['place', 'move', 'delete', 'call', 'clear'])

/** Tolerant: a hand-edited or damaged file yields what is usable, never an exception. */
export function parseMeta(text: string): MiniworldsMeta {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return emptyMeta()
  }
  if (typeof raw !== 'object' || raw === null) return emptyMeta()
  const r = raw as Record<string, unknown>
  const done: Record<string, boolean> = {}
  if (typeof r.tasksDone === 'object' && r.tasksDone !== null) {
    for (const [k, v] of Object.entries(r.tasksDone)) if (v === true) done[k] = true
  }
  return {
    journal: Array.isArray(r.journal)
      ? (r.journal.filter((o) => typeof o === 'object' && o !== null && OPS.has((o as { op?: string }).op ?? '')) as Op[])
      : [],
    tasks: Array.isArray(r.tasks) ? r.tasks.filter((t): t is string => typeof t === 'string') : [],
    tasksDone: done,
    ...(Array.isArray(r.checks) ? { checks: r.checks.map((c) => parseCheck(c)) } : {}),
    ...(r.suggested === true ? { suggested: true } : {}),
    ...(typeof r.images === 'object' && r.images !== null ? { images: parseProvenance(r.images) } : {}),
  }
}

export async function loadMeta(fs: Fs): Promise<MiniworldsMeta> {
  if (await fs.exists(META_FILE)) return parseMeta(await fs.read(META_FILE))
  return (await fs.exists(LEGACY_META_FILE)) ? parseMeta(await fs.read(LEGACY_META_FILE)) : emptyMeta()
}

const isEmpty = (m: MiniworldsMeta) => m.journal.length === 0 && m.tasks.length === 0 && Object.keys(m.tasksDone).length === 0 && Object.keys(m.images ?? {}).length === 0

/** Writes miniworlds.json (and drops a legacy greenfoot.json); an empty meta removes the files instead of leaving "{}" around. */
export async function saveMeta(fs: Fs, meta: MiniworldsMeta): Promise<void> {
  // the new file first: a failing write must not cost the old data
  if (!isEmpty(meta)) await fs.write(META_FILE, JSON.stringify(meta, null, 1))
  for (const old of [LEGACY_META_FILE, ...(isEmpty(meta) ? [META_FILE] : [])]) if (await fs.exists(old)) await fs.remove(old)
}

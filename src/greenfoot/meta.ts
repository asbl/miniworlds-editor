import type { Fs } from '../workspace'
import type { Op } from './journal'

export const META_FILE = 'greenfoot.json'

/** Per-project Greenfoot data. Same file and shape as the old web client wrote, so its projects open unchanged. */
export interface GreenfootMeta {
  journal: Op[]
  tasks: string[]
  tasksDone: Record<string, boolean>
}

export const emptyMeta = (): GreenfootMeta => ({ journal: [], tasks: [], tasksDone: {} })

const OPS = new Set(['place', 'move', 'delete', 'call', 'clear'])

/** Tolerant: a hand-edited or damaged file yields what is usable, never an exception. */
export function parseMeta(text: string): GreenfootMeta {
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
  }
}

export async function loadMeta(fs: Fs): Promise<GreenfootMeta> {
  return (await fs.exists(META_FILE)) ? parseMeta(await fs.read(META_FILE)) : emptyMeta()
}

const isEmpty = (m: GreenfootMeta) => m.journal.length === 0 && m.tasks.length === 0 && Object.keys(m.tasksDone).length === 0

/** Writes greenfoot.json; an empty meta removes the file instead of leaving "{}" around. */
export async function saveMeta(fs: Fs, meta: GreenfootMeta): Promise<void> {
  if (isEmpty(meta)) {
    if (await fs.exists(META_FILE)) await fs.remove(META_FILE)
    return
  }
  await fs.write(META_FILE, JSON.stringify(meta, null, 1))
}

import type { ActorInfo, ScenarioClient } from './scenario'

/**
 * Journal ("Startaufstellung"): what the pupil did by hand before the first frame (place, move, delete, call a
 * method) is remembered and replayed after every reload, so editing code does not empty the world.
 *
 * Objects are addressed by (class, index within that class), not by handle: handles change on every start.
 * That stays valid as long as the program creates the same objects at start; steps that no longer fit are
 * counted and skipped instead of failing.
 */
export type Op =
  | { op: 'place'; cls: string; x: number; y: number; args?: string[]; dir?: number }
  | { op: 'move'; cls: string; n: number; x: number; y: number }
  | { op: 'delete'; cls: string; n: number }
  | { op: 'call'; cls: string; n: number; method: string; texts: string[] }
  | { op: 'clear' }

export const MAX_OPS = 500

/** The client calls the journal needs; lets tests use a plain in-memory world. */
export type JournalClient = Pick<ScenarioClient, 'snapshot' | 'place' | 'move' | 'remove' | 'call'>

export interface ActorKey {
  cls: string
  n: number
}

export function keyFor(actors: readonly ActorInfo[], handle: string): ActorKey | null {
  const counter = new Map<string, number>()
  for (const a of actors) {
    if (a.handle === handle) return { cls: a.cls, n: counter.get(a.cls) ?? 0 }
    counter.set(a.cls, (counter.get(a.cls) ?? 0) + 1)
  }
  return null
}

export function handleFor(actors: readonly ActorInfo[], cls: string, n: number): string | null {
  let seen = 0
  for (const a of actors) {
    if (a.cls !== cls) continue
    if (seen === n) return a.handle
    seen++
  }
  return null
}

const round2 = (v: number) => Math.round(v * 100) / 100
export const roundPoint = (x: number, y: number): [number, number] => [round2(x), round2(y)]

/** New list with `op` at the end; consecutive moves of the same object are merged. */
export function append(ops: readonly Op[], op: Op): Op[] {
  const last = ops.at(-1)
  if (op.op === 'move' && last?.op === 'move' && last.cls === op.cls && last.n === op.n) {
    return [...ops.slice(0, -1), { ...last, x: op.x, y: op.y }]
  }
  const next = [...ops, op]
  return next.length > MAX_OPS ? next.slice(next.length - MAX_OPS) : next
}

/** The whole current world as a start setup: clear, then place every actor again. */
export async function fromWorld(client: JournalClient): Promise<Op[]> {
  const { actors } = await client.snapshot()
  const ops: Op[] = [{ op: 'clear' }]
  for (const a of actors) {
    const [x, y] = roundPoint(a.x, a.y)
    ops.push({ op: 'place', cls: a.cls, x, y, ...(a.direction ? { dir: a.direction } : {}) })
  }
  return ops
}

async function apply(client: JournalClient, op: Op): Promise<void> {
  if (op.op === 'place') {
    const handle = await client.place(op.cls, op.x, op.y, op.args ?? [])
    if (op.dir) await client.call(handle, 'turn_right', [String(op.dir)])
    return
  }
  const { actors } = await client.snapshot()
  if (op.op === 'clear') {
    for (const a of actors) await client.remove(a.handle)
    return
  }
  const handle = handleFor(actors, op.cls, op.n)
  if (!handle) throw new Error(`${op.cls} Nr. ${op.n + 1} gibt es nicht mehr.`)
  if (op.op === 'move') await client.move(handle, op.x, op.y)
  else if (op.op === 'delete') await client.remove(handle)
  else await client.call(handle, op.method, op.texts)
}

export interface ReplayResult {
  total: number
  failed: number
  firstError: string
}

/** Plays all steps; a failing step is counted and skipped. */
export async function replay(client: JournalClient, ops: readonly Op[]): Promise<ReplayResult> {
  let failed = 0
  let firstError = ''
  for (const op of ops) {
    try {
      await apply(client, op)
    } catch (error) {
      failed++
      firstError ||= error instanceof Error ? error.message : String(error)
    }
  }
  return { total: ops.length, failed, firstError }
}

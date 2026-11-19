import type { TraceBatch } from '../runtime/protocol'

export interface TraceRow {
  key: string
  path: string
  line: number
  cls: string
  method: string
  count: number
  lastAt: number
}

export interface IgnoredRow {
  event: string
  existing: string[]
  count: number
  lastAt: number
}

/** A method that fires every frame says nothing by lighting up; the panel lists it, the editor and diagram stay calm. */
export const isFrameMethod = (method: string) => method === 'act'

/** What the engine called since the program started: one row per method with a count and the time of its last call. */
export class TraceStore {
  private rows = new Map<string, TraceRow>()
  private ignoredRows = new Map<string, IgnoredRow>()

  /** Adds a batch; returns the rows it touched (so the caller can flash them). */
  add(batch: TraceBatch, now: number): TraceRow[] {
    const touched: TraceRow[] = []
    for (const [path, line, cls, method, count] of batch.calls) {
      const key = `${path}:${cls}.${method}`
      const row = this.rows.get(key)
      if (row) {
        row.count += count
        row.lastAt = now
        row.line = line
        touched.push(row)
      } else {
        const fresh = { key, path, line, cls, method, count, lastAt: now }
        this.rows.set(key, fresh)
        touched.push(fresh)
      }
    }
    for (const [event, existing, count] of batch.ignored) {
      const key = `${event}|${existing.join(',')}`
      const row = this.ignoredRows.get(key)
      if (row) {
        row.count += count
        row.lastAt = now
      } else this.ignoredRows.set(key, { event, existing, count, lastAt: now })
    }
    return touched
  }

  clear(): void {
    this.rows.clear()
    this.ignoredRows.clear()
  }

  /** Rows by class, then method; `act` last within its class. */
  list(): TraceRow[] {
    return [...this.rows.values()].sort((a, b) => a.cls.localeCompare(b.cls) || Number(isFrameMethod(a.method)) - Number(isFrameMethod(b.method)) || a.method.localeCompare(b.method))
  }

  ignored(): IgnoredRow[] {
    return [...this.ignoredRows.values()].sort((a, b) => b.lastAt - a.lastAt)
  }

  /** Class names with an event method (not `act`) called within `windowMs`. */
  firedClasses(now: number, windowMs: number): Set<string> {
    const out = new Set<string>()
    for (const row of this.rows.values()) if (!isFrameMethod(row.method) && now - row.lastAt <= windowMs) out.add(row.cls)
    return out
  }

  get size(): number {
    return this.rows.size
  }
}

export interface IgnoredText {
  /** `key` / `click`, and the key's name for a key. */
  kind: 'key' | 'click'
  key?: string
  existing: string[]
}

/** Reads an event name from the engine (`key_down_w`, `mouse_left_down`) as something a pupil can be told about. */
export function describeIgnored(row: IgnoredRow): IgnoredText {
  const key = /^key_(?:down|up)_(.+)$/.exec(row.event)
  if (key) return { kind: 'key', key: key[1], existing: row.existing }
  return { kind: 'click', existing: row.existing }
}

import type { Fs } from '../workspace'

export type SnapshotReason = 'open' | 'run' | 'timer' | 'manual' | 'before-restore' | 'before-delete'

export interface Snapshot {
  id: string
  /** Milliseconds since 1970. */
  time: number
  reason: SnapshotReason
  /** Name given by the user (manual snapshots, or renamed later). */
  label?: string
  /** path -> content hash */
  files: Record<string, string>
  /** Total size of the texts in characters (shown, and used for the size limit). */
  size: number
}

export interface HistoryOptions {
  now?: () => number
  /** Most snapshots kept; the oldest automatic ones go first (named ones stay). */
  maxSnapshots?: number
  /** Limit of the stored texts in characters. */
  maxChars?: number
}

const INDEX = 'index.json'
const objectPath = (hash: string) => `objects/${hash}`

/** Fast deterministic 53-bit hash (cyrb53), twice with different seeds plus the length: no practical collisions for texts of a project. */
export function hashText(text: string): string {
  const one = (seed: number) => {
    let h1 = 0xdeadbeef ^ seed
    let h2 = 0x41c6ce57 ^ seed
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i)
      h1 = Math.imul(h1 ^ ch, 2654435761)
      h2 = Math.imul(h2 ^ ch, 1597334677)
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
  }
  return `${one(0)}${one(1)}-${text.length.toString(16)}`
}

/**
 * Snapshots of a project's text files: what the user can go back to. Stored in a file system of its own (not the project's):
 * `index.json` lists the snapshots, `objects/<hash>` holds each distinct text once, so hundreds of snapshots of a small
 * project stay small. Pictures are not part of it (they are big and rarely change by accident).
 */
export class History {
  private index: Snapshot[] | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private readonly now: () => number
  private readonly maxSnapshots: number
  private readonly maxChars: number

  constructor(
    private fs: Fs,
    options: HistoryOptions = {},
  ) {
    this.now = options.now ?? Date.now
    this.maxSnapshots = options.maxSnapshots ?? 150
    this.maxChars = options.maxChars ?? 6_000_000
  }

  /** Operations run one after the other: two quick calls never interleave their reads and writes. */
  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.catch(() => {})
    return run
  }

  private async load(): Promise<Snapshot[]> {
    if (this.index) return this.index
    try {
      const raw = JSON.parse(await this.fs.read(INDEX)) as unknown
      this.index = Array.isArray(raw) ? raw.filter(isSnapshot) : []
    } catch {
      this.index = [] // none yet, or damaged: start over rather than fail
    }
    return this.index
  }

  private async save(): Promise<void> {
    await this.fs.write(INDEX, JSON.stringify(this.index ?? []))
  }

  /** Newest first. */
  list(): Promise<Snapshot[]> {
    return this.exclusive(async () => [...(await this.load())].sort((a, b) => b.time - a.time))
  }

  /**
   * Remember the project as it is now. Returns null when it equals the newest snapshot (nothing new to remember),
   * unless the user asked for it by name.
   */
  record(texts: Record<string, string>, reason: SnapshotReason, label?: string): Promise<Snapshot | null> {
    return this.exclusive(async () => {
      const index = await this.load()
      const files: Record<string, string> = {}
      let size = 0
      for (const [path, text] of Object.entries(texts)) {
        files[path] = hashText(text)
        size += text.length
      }
      const newest = [...index].sort((a, b) => b.time - a.time)[0]
      if (!label && newest && sameFiles(newest.files, files)) return null
      for (const [path, text] of Object.entries(texts)) {
        const file = objectPath(files[path] as string)
        if (!(await this.fs.exists(file))) await this.fs.write(file, text)
      }
      // ids sort by time; the counter keeps two snapshots in the same millisecond apart
      const time = Math.max(this.now(), (newest?.time ?? 0) + 1)
      const snapshot: Snapshot = { id: `${time.toString(36)}-${Math.random().toString(36).slice(2, 6)}`, time, reason, ...(label ? { label } : {}), files, size }
      index.push(snapshot)
      await this.prune()
      await this.save()
      return snapshot
    })
  }

  /** The texts of a snapshot (path -> text). A missing object (storage cleaned from outside) is left out. */
  read(id: string): Promise<Record<string, string>> {
    return this.exclusive(async () => {
      const snapshot = (await this.load()).find((s) => s.id === id)
      if (!snapshot) throw new Error('snapshot-not-found')
      const out: Record<string, string> = {}
      for (const [path, hash] of Object.entries(snapshot.files)) {
        try {
          out[path] = await this.fs.read(objectPath(hash))
        } catch {
          /* gone */
        }
      }
      return out
    })
  }

  label(id: string, label: string): Promise<void> {
    return this.exclusive(async () => {
      const snapshot = (await this.load()).find((s) => s.id === id)
      if (!snapshot) return
      if (label.trim()) snapshot.label = label.trim()
      else delete snapshot.label
      await this.save()
    })
  }

  remove(id: string): Promise<void> {
    return this.exclusive(async () => {
      const index = await this.load()
      const at = index.findIndex((s) => s.id === id)
      if (at < 0) return
      index.splice(at, 1)
      await this.collect()
      await this.save()
    })
  }

  /** Drops old automatic snapshots beyond the limits, then the texts nobody refers to any more. */
  private async prune(): Promise<void> {
    const index = this.index as Snapshot[]
    const oldestAutomatic = () => index.filter((s) => !s.label && s.reason !== 'manual').sort((a, b) => a.time - b.time)[0]
    const chars = () => {
      // distinct texts only: the same text in many snapshots is stored once
      const seen = new Map<string, number>()
      for (const s of index) for (const hash of Object.values(s.files)) seen.set(hash, Number.parseInt(hash.split('-')[1] as string, 16))
      return [...seen.values()].reduce((a, b) => a + b, 0)
    }
    while (index.length > 1 && (index.length > this.maxSnapshots || chars() > this.maxChars)) {
      const victim = oldestAutomatic()
      if (!victim) break
      index.splice(index.indexOf(victim), 1)
    }
    await this.collect()
  }

  private async collect(): Promise<void> {
    const used = new Set(((this.index as Snapshot[]) ?? []).flatMap((s) => Object.values(s.files)))
    for (const entry of await this.fs.list()) {
      if (entry.kind === 'file' && entry.path.startsWith('objects/') && !used.has(entry.path.slice('objects/'.length))) await this.fs.remove(entry.path).catch(() => {})
    }
  }
}

function isSnapshot(value: unknown): value is Snapshot {
  const s = value as Snapshot
  return typeof s === 'object' && s !== null && typeof s.id === 'string' && typeof s.time === 'number' && typeof s.files === 'object' && s.files !== null && typeof s.reason === 'string'
}

function sameFiles(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k])
}

/** `missing`: in the snapshot, not in the project now (restoring brings it back); `new`: in the project, not in the snapshot (a full restore removes it). */
export type FileStatus = 'same' | 'changed' | 'missing' | 'new'

/** How the project's texts differ from a snapshot: what restoring it would change. */
export function compare(snapshot: Record<string, string>, current: Record<string, string>): Record<string, FileStatus> {
  const out: Record<string, FileStatus> = {}
  for (const path of new Set([...Object.keys(snapshot), ...Object.keys(current)])) {
    const inCurrent = Object.hasOwn(current, path)
    const inSnapshot = Object.hasOwn(snapshot, path)
    out[path] = !inCurrent ? 'missing' : !inSnapshot ? 'new' : snapshot[path] === current[path] ? 'same' : 'changed'
  }
  return out
}

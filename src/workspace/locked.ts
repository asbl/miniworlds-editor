import type { Fs } from './types'

const queues = new Map<string, Promise<unknown>>()

/** A whole Git operation must not interleave with another Git operation. */
export async function withLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request(key, action)
  const previous = queues.get(key) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(action)
  queues.set(key, next)
  try { return await next } finally { if (queues.get(key) === next) queues.delete(key) }
}

/** All project writers, including autosave in other tabs, share the transaction lock. */
export class LockedFs implements Fs {
  constructor(private raw: Fs, private key: string) {}
  exclusive<T>(action: (fs: Fs) => Promise<T>): Promise<T> { return withLock(this.key, () => action(this.raw)) }
  list() { return this.exclusive(fs => fs.list()) }
  read(path: string) { return this.exclusive(fs => fs.read(path)) }
  readBytes(path: string) { return this.exclusive(fs => fs.readBytes(path)) }
  exists(path: string) { return this.exclusive(fs => fs.exists(path)) }
  write(path: string, content: string | Uint8Array) { return this.exclusive(fs => fs.write(path, content)) }
  remove(path: string) { return this.exclusive(fs => fs.remove(path)) }
  rename(from: string, to: string) { return this.exclusive(fs => fs.rename(from, to)) }
}

export function exclusiveFs<T>(fs: Fs, action: (raw: Fs) => Promise<T>): Promise<T> {
  return fs.exclusive ? fs.exclusive(action) : action(fs)
}

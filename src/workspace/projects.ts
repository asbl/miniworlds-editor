import { MemoryFs } from './memory'
import { OpfsFs } from './opfs'
import type { Fs, Workspace } from './types'

/** Several projects side by side (one OPFS directory each). The UI only sees this and `Workspace`. */
export interface ProjectStore {
  readonly kind: string
  list(): Promise<string[]>
  /** Opens a project; creates an empty one if the name is new. */
  open(name: string): Promise<Workspace>
  remove(name: string): Promise<void>
  exists(name: string): Promise<boolean>
}

const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f]/
export const MAX_PROJECT_NAME = 60

/** Returns the trimmed name, or throws a message key-free Error (the UI maps empty/invalid to its own text). */
export function validateProjectName(raw: string): string {
  const name = raw.trim()
  if (name === '' || name === '.' || name === '..') throw new Error('invalid-name')
  if (name.length > MAX_PROJECT_NAME || FORBIDDEN.test(name)) throw new Error('invalid-name')
  return name
}

export class MemoryStore implements ProjectStore {
  readonly kind = 'memory'
  private projects = new Map<string, MemoryFs>()

  async list() {
    return [...this.projects.keys()].sort((a, b) => a.localeCompare(b))
  }
  async open(name: string): Promise<Workspace> {
    const key = validateProjectName(name)
    let fs = this.projects.get(key)
    if (!fs) this.projects.set(key, (fs = new MemoryFs()))
    return { kind: this.kind, fs }
  }
  async remove(name: string) {
    this.projects.delete(name)
  }
  async exists(name: string) {
    return this.projects.has(name)
  }
}

export class OpfsStore implements ProjectStore {
  readonly kind = 'opfs'

  static isSupported() {
    return OpfsFs.isSupported()
  }
  private async dir() {
    const base = await navigator.storage.getDirectory()
    return base.getDirectoryHandle('projects', { create: true })
  }
  async list() {
    const names: string[] = []
    for await (const [name, handle] of (await this.dir()).entries()) if (handle.kind === 'directory') names.push(name)
    return names.sort((a, b) => a.localeCompare(b))
  }
  async open(name: string): Promise<Workspace> {
    return { kind: this.kind, fs: (await OpfsFs.open(validateProjectName(name))) as Fs }
  }
  async remove(name: string) {
    await (await this.dir()).removeEntry(name, { recursive: true })
  }
  async exists(name: string) {
    try {
      await (await this.dir()).getDirectoryHandle(name)
      return true
    } catch {
      return false
    }
  }
}

/** OPFS when available (and working), otherwise memory (lost on reload; the UI warns about it). */
export async function createBrowserStore(): Promise<ProjectStore> {
  if (OpfsStore.isSupported()) {
    try {
      const store = new OpfsStore()
      await store.list()
      return store
    } catch (error) {
      console.warn('OPFS nicht nutzbar, Fallback auf Speicher', error)
    }
  }
  return new MemoryStore()
}

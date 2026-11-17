/**
 * Workspace: the only API the UI may use to reach files (and, later, packages,
 * language service and scenario host). Implementations: OPFS/memory in the
 * browser; Tauri or a remote server could follow without touching the UI.
 */
export interface FileEntry {
  /** POSIX-style path relative to the project root, e.g. "classes/Crab.py". */
  path: string
  kind: 'file' | 'dir'
}

export interface Fs {
  /** All entries below the project root, recursive, sorted by path. */
  list(): Promise<FileEntry[]>
  read(path: string): Promise<string>
  readBytes(path: string): Promise<Uint8Array>
  /** Creates missing parent directories. */
  write(path: string, content: string | Uint8Array): Promise<void>
  exists(path: string): Promise<boolean>
  remove(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>
}

export interface Workspace {
  /** Which backend is active, e.g. "opfs" or "memory". */
  readonly kind: string
  readonly fs: Fs
}

export function normalizePath(path: string): string {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') throw new Error(`Ungültiger Pfad: ${path}`)
    parts.push(part)
  }
  if (parts.length === 0) throw new Error('Leerer Pfad')
  return parts.join('/')
}

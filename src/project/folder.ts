import type { Fs } from '../workspace'
import { normalizePath } from '../workspace/types'
import { commonRoot, JUNK, MAX_ZIP_BYTES, MAX_ZIP_FILES } from './zip'

/**
 * Import of a whole folder, the way students worked before: a directory with `main.py`, images, sounds …
 * Sources: the folder picker (`<input webkitdirectory>`, works in every browser) and a folder dropped onto the window.
 */

export interface SourceFile {
  /** Path including the folder's own name, e.g. "Krabbe/images/crab.png". */
  path: string
  size: number
  read(): Promise<Uint8Array>
}

export interface FolderSource {
  /** The folder's name, when there was exactly one top-level folder. */
  name: string | null
  /** Paths relative to that folder. */
  files: SourceFile[]
}

export class FolderError extends Error {
  constructor(readonly code: 'empty' | 'too-many-files' | 'too-large') {
    super(code)
  }
}

/** What an IDE or a virtual environment leaves next to the program; never part of a project. */
const SKIP = /(^|\/)(\.idea|\.vscode|venv|\.venv|node_modules|site-packages)(\/|$)/

export function isSkipped(path: string): boolean {
  return JUNK.test(path) || SKIP.test(path)
}

/** Paths are checked relative to the folder, so that a folder that is itself called "venv" or ".idea" still imports. */
function finish(all: SourceFile[]): FolderSource {
  const strip = commonRoot(all.map((f) => f.path))
  const files = all.map((f) => ({ ...f, path: strip ? f.path.slice(strip.length) : f.path })).filter((f) => !isSkipped(f.path))
  return { name: strip ? strip.slice(0, -1) : null, files }
}

/** The files chosen with `<input type="file" webkitdirectory>`. */
export function fromFileList(list: ArrayLike<File>): FolderSource {
  return finish(
    Array.from(list).map((file) => ({
      path: file.webkitRelativePath || file.name,
      size: file.size,
      read: async () => new Uint8Array(await file.arrayBuffer()),
    })),
  )
}

/** True if a drag carries something that may be a folder (the entries themselves can only be read on drop). */
export function dragHasFiles(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types).includes('Files')
}

/**
 * If the drop contains folders, returns the promise of their contents, one source per folder (each becomes its own
 * project). Loose files dropped alongside go to the first folder. Otherwise null: plain files are handled elsewhere.
 * Must be called synchronously in the drop handler: the browser invalidates the entries afterwards.
 */
export function droppedFolders(dt: DataTransfer | null): Promise<FolderSource[]> | null {
  if (!dt) return null
  const entries = Array.from(dt.items ?? [])
    .map((item) => (item.kind === 'file' ? item.webkitGetAsEntry?.() : null))
    .filter((entry): entry is FileSystemEntry => !!entry)
  if (!entries.some((entry) => entry.isDirectory)) return null
  return (async () => {
    const sources: FolderSource[] = []
    const loose: SourceFile[] = []
    for (const entry of entries) {
      const files: SourceFile[] = []
      await walk(entry, '', files)
      if (entry.isDirectory) sources.push({ name: entry.name, files: files.filter((f) => !isSkipped(f.path)) })
      else loose.push(...files.filter((f) => !isSkipped(f.path)))
    }
    ;(sources[0] as FolderSource).files.push(...loose)
    return sources
  })()
}

/** Collects the files below `entry` with paths relative to it (a dropped single file: just its name). */
async function walk(entry: FileSystemEntry, rel: string, out: SourceFile[]): Promise<void> {
  if (out.length > MAX_ZIP_FILES) throw new FolderError('too-many-files')
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
    out.push({ path: rel || entry.name, size: file.size, read: async () => new Uint8Array(await file.arrayBuffer()) })
    return
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader()
  for (;;) {
    // readEntries returns the directory in chunks until it hands back an empty list
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
    if (batch.length === 0) break
    for (const child of batch) {
      const path = rel ? `${rel}/${child.name}` : child.name
      if (!isSkipped(child.isDirectory ? path + '/' : path)) await walk(child, path, out) // do not even descend into venv/.git
    }
  }
}

/** Writes the folder's files into `fs`; returns how many. */
export async function importFolder(fs: Fs, source: FolderSource): Promise<number> {
  if (source.files.length === 0) throw new FolderError('empty')
  if (source.files.length > MAX_ZIP_FILES) throw new FolderError('too-many-files')
  if (source.files.reduce((sum, f) => sum + f.size, 0) > MAX_ZIP_BYTES) throw new FolderError('too-large')
  for (const file of source.files) await fs.write(normalizePath(file.path), await file.read())
  return source.files.length
}

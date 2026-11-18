import type { Fs } from '../workspace'
import { decodeContent, encodeFile, type FileContent } from './protocol'

/** All project files for a message. */
export async function collectFiles(fs: Fs): Promise<Record<string, FileContent>> {
  const out: Record<string, FileContent> = {}
  for (const entry of await fs.list()) if (entry.kind === 'file') out[entry.path] = encodeFile(entry.path, await fs.readBytes(entry.path))
  return out
}

/**
 * Replace the project. Everything is decoded first (a bad file fails before anything changes), the new files are written,
 * and only then are the files the page did not send removed.
 */
export async function replaceFiles(fs: Fs, files: Record<string, FileContent>): Promise<void> {
  const prepared = Object.entries(files).map(([path, content]) => [path, decodeContent(content)] as const)
  const keep = new Set(prepared.map(([path]) => path)) // a Set: "constructor" or "toString" are not special
  for (const [path, data] of prepared) await fs.write(path, data)
  for (const entry of await fs.list()) if (entry.kind === 'file' && !keep.has(entry.path)) await fs.remove(entry.path)
}

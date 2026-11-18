import type { Fs } from '../workspace'
import { decodeContent, encodeFile, type FileContent } from './protocol'

/** All project files for a message. */
export async function collectFiles(fs: Fs): Promise<Record<string, FileContent>> {
  const out: Record<string, FileContent> = {}
  for (const entry of await fs.list()) if (entry.kind === 'file') out[entry.path] = encodeFile(entry.path, await fs.readBytes(entry.path))
  return out
}

/** Replace the project: files the page did not send are removed. */
export async function replaceFiles(fs: Fs, files: Record<string, FileContent>): Promise<void> {
  for (const entry of await fs.list()) if (entry.kind === 'file' && !(entry.path in files)) await fs.remove(entry.path)
  for (const [path, content] of Object.entries(files)) await fs.write(path, decodeContent(content))
}

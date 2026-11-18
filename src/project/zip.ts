import { unzipSync, zipSync, type Zippable } from 'fflate'
import type { Fs } from '../workspace'
import { normalizePath } from '../workspace/types'
import { extensionOf } from './search'

export const MAX_ZIP_FILES = 5000
export const MAX_ZIP_BYTES = 150 * 1024 * 1024
const STORED = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'zip', 'ogg', 'mp3'])
export const JUNK = /(^|\/)(__MACOSX|__pycache__|\.git|\.DS_Store|Thumbs\.db)(\/|$)/

export async function exportZip(fs: Fs): Promise<Uint8Array> {
  const data: Zippable = {}
  for (const entry of await fs.list()) {
    if (entry.kind !== 'file' || JUNK.test(entry.path)) continue
    // images are already compressed; storing them is faster and not larger
    data[entry.path] = [await fs.readBytes(entry.path), { level: STORED.has(extensionOf(entry.path)) ? 0 : 6 }]
  }
  return zipSync(data)
}

export class ZipError extends Error {}

/** If every file sits below one common top folder ("MyProject/…"), returns that prefix. */
export function commonRoot(paths: string[]): string {
  if (paths.length === 0) return ''
  const first = (paths[0] as string).split('/')
  if (first.length < 2) return ''
  const root = first[0] as string
  return paths.every((p) => p.startsWith(root + '/')) ? root + '/' : ''
}

/** Writes the archive's files into `fs`. Existing files with the same path are overwritten. */
export async function importZip(fs: Fs, bytes: Uint8Array): Promise<number> {
  let total = 0
  let count = 0
  let raw: Record<string, Uint8Array>
  try {
    raw = unzipSync(bytes, {
      filter: (file) => {
        if (file.name.endsWith('/') || JUNK.test(file.name)) return false
        if (++count > MAX_ZIP_FILES) throw new ZipError('too-many-files')
        total += file.originalSize
        if (total > MAX_ZIP_BYTES) throw new ZipError('too-large')
        return true
      },
    })
  } catch (error) {
    if (error instanceof ZipError) throw error
    throw new ZipError('not-a-zip')
  }
  const names = Object.keys(raw)
  if (names.some((n) => n.split('/').includes('..') || n.startsWith('/'))) throw new ZipError('unsafe-path')
  const strip = commonRoot(names)
  for (const name of names) {
    const path = normalizePath(strip ? name.slice(strip.length) : name) // rejects ".." (zip-slip)
    await fs.write(path, raw[name] as Uint8Array)
  }
  return names.length
}


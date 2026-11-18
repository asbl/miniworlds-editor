import { MAX_ZIP_BYTES, MAX_ZIP_FILES } from '../project/zip'
import { normalizePath } from '../workspace/types'

/**
 * Embedding the editor in another page (Moodle, H5P, a course site): `<iframe src=".../?embed=1">` and `postMessage`.
 * Every message is an object with `app: 'miniworlds-editor'`, a `type` and optionally an `id` that the answer repeats.
 *
 * page -> editor
 *   load       { files, lang?, mode? }  replace the project (text files as strings, binaries as { base64 })
 *   get-files  { id }                          answered with `files`
 * editor -> page
 *   ready      {}                              the editor listens (sent when it started, before any `load`)
 *   loaded     { id? }                         `load` was applied
 *   files      { id?, files }                  all project files
 *   change     { paths }                       these files changed (a hint, not the content: fetch with `get-files`; the editor
 *                                              has not necessarily saved the last keystrokes yet, `get-files` does that first)
 *   error      { id?, message }                a message was refused
 */
export const APP = 'miniworlds-editor'

export type FileContent = string | { base64: string }

export type Incoming =
  | { type: 'load'; id?: string; files: Record<string, FileContent>; lang?: 'de' | 'en'; mode?: 'program' | 'miniworlds' }
  | { type: 'get-files'; id?: string }

export type Outgoing =
  | { type: 'ready' }
  | { type: 'loaded'; id?: string }
  | { type: 'files'; id?: string; files: Record<string, FileContent> }
  | { type: 'change'; paths: string[] }
  | { type: 'error'; id?: string; message: string }

export class EmbedError extends Error {}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

const id = (raw: unknown): string | undefined => (typeof raw === 'string' && raw.length <= 100 ? raw : undefined)

/** A valid message from the page, or null (anything else is ignored: other scripts also post messages). */
export function parseIncoming(data: unknown): Incoming | null {
  if (typeof data !== 'object' || data === null) return null
  const m = data as Record<string, unknown>
  if (m.app !== APP) return null
  if (m.type === 'get-files') return { type: 'get-files', id: id(m.id) }
  if (m.type !== 'load') return null
  if (typeof m.files !== 'object' || m.files === null || Array.isArray(m.files)) throw new EmbedError('load: "files" must be an object path -> content')
  const entries = Object.entries(m.files as Record<string, unknown>)
  if (entries.length > MAX_ZIP_FILES) throw new EmbedError('load: too many files')
  const files: Record<string, FileContent> = {}
  let bytes = 0
  for (const [rawPath, value] of entries) {
    let path: string
    try {
      path = normalizePath(rawPath) // rejects ".." and empty paths
    } catch {
      throw new EmbedError(`load: invalid path "${rawPath}"`)
    }
    if (typeof value === 'string') {
      bytes += value.length
      files[path] = value
    } else if (typeof value === 'object' && value !== null && typeof (value as { base64?: unknown }).base64 === 'string') {
      const base64 = (value as { base64: string }).base64
      // checked here, not when writing: a bad file must not leave a half-replaced project behind
      if (!BASE64.test(base64) || base64.length % 4 !== 0) throw new EmbedError(`load: "${rawPath}" is not valid base64`)
      bytes += base64.length
      files[path] = { base64 }
    } else throw new EmbedError(`load: "${rawPath}" must be a string or { base64 }`)
    if (bytes > MAX_ZIP_BYTES) throw new EmbedError('load: too large')
  }
  const lang = m.lang === 'de' || m.lang === 'en' ? m.lang : undefined
  const mode = m.mode === 'program' || m.mode === 'miniworlds' ? m.mode : undefined
  return { type: 'load', id: id(m.id), files, lang, mode }
}

export function decodeContent(content: FileContent): string | Uint8Array {
  if (typeof content === 'string') return content
  const binary = atob(content.base64)
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

const TEXT = new Set(['py', 'toml', 'json', 'txt', 'md', 'csv', 'cfg', 'ini', 'yaml', 'yml'])

/** Text files go out as strings, everything else as base64 (JSON-safe). */
export function encodeFile(path: string, bytes: Uint8Array): FileContent {
  const extension = path.includes('.') ? (path.split('.').pop() as string).toLowerCase() : ''
  if (TEXT.has(extension)) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      /* not valid UTF-8: binary */
    }
  }
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return { base64: btoa(binary) }
}

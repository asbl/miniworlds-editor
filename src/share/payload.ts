import { deflateSync, Inflate } from 'fflate'
import { decodeContent, encodeFile, type FileContent } from '../embed/protocol'
import type { Provenance } from '../miniworlds/provenance'
import { isImagePath } from '../project/search'
import { MAX_ZIP_BYTES, MAX_ZIP_FILES } from '../project/zip'
import { normalizePath } from '../workspace/types'

/**
 * A game as a link. The whole project travels in the part after `#` (which a browser never sends to a server), so nothing is
 * stored anywhere and nobody hosts anybody's pictures. Pictures need care, because they are what is protected by copyright:
 *  - library pictures are original work of this project: only their name travels, the picture is drawn again on arrival;
 *  - pictures the pupil drew are theirs and travel along;
 *  - uploaded (or unknown) pictures travel only if the pupil confirms that they may be shared; otherwise they are replaced by
 *    a plain placeholder.
 */
export interface SharePayload {
  v: 1
  name: string
  miniworlds: string | null
  packages: string[]
  files: Record<string, FileContent>
  /** Library pictures, to be drawn again: file path and library id. */
  library: { path: string; id: string }[]
  /** Pictures left out (not cleared for sharing); a placeholder takes their place. */
  withheld: string[]
  /** Uploaded pictures that travel along because the pupil confirmed they may be shared. */
  shared: string[]
}

export const HASH_KEY = 'play='
/** Longer links break in chat apps and mail; the dialog warns from here. */
export const LINK_WARN = 6000
/** Beyond this a link is no sensible way to pass a game on (use the ZIP). */
export const LINK_MAX = 200_000
const EXCLUDED = /(^|\/)(__MACOSX|__pycache__|\.git|\.DS_Store|Thumbs\.db)(\/|$)|^(miniworlds|greenfoot)\.json$/

export class ShareError extends Error {}

export interface ImageReport {
  library: { path: string; id: string }[]
  /** Drawn in the editor's drawing tool. */
  drawn: string[]
  /** Uploaded, dropped in, or of unknown origin: the pupil has to vouch for these. */
  uploads: string[]
}

export function classifyImages(paths: readonly string[], provenance: Provenance, libraryIds: ReadonlySet<string>): ImageReport {
  const report: ImageReport = { library: [], drawn: [], uploads: [] }
  for (const path of paths.filter(isImagePath).sort()) {
    const source = provenance[path]
    if (source?.source === 'library' && libraryIds.has(source.id)) report.library.push({ path, id: source.id })
    else if (source?.source === 'drawn') report.drawn.push(path)
    else report.uploads.push(path)
  }
  return report
}

export interface BuildOptions {
  name: string
  miniworlds: string | null
  packages: string[]
  files: Record<string, Uint8Array>
  provenance: Provenance
  libraryIds: ReadonlySet<string>
  /** Uploaded pictures the pupil confirmed. */
  allowed: ReadonlySet<string>
}

export function buildPayload(o: BuildOptions): SharePayload {
  const paths = Object.keys(o.files).filter((p) => !EXCLUDED.test(p))
  const images = classifyImages(paths, o.provenance, o.libraryIds)
  const library = images.library
  const left = new Set(library.map((l) => l.path))
  const withheld = images.uploads.filter((p) => !o.allowed.has(p))
  for (const p of withheld) left.add(p)
  const files: Record<string, FileContent> = {}
  for (const path of paths.sort()) if (!left.has(path)) files[path] = encodeFile(path, o.files[path] as Uint8Array)
  return {
    v: 1,
    name: o.name,
    miniworlds: o.miniworlds,
    packages: o.packages,
    files,
    library,
    withheld,
    shared: images.uploads.filter((p) => o.allowed.has(p)),
  }
}

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const fromBase64Url = (text: string): Uint8Array => {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(padded + '='.repeat((4 - (padded.length % 4)) % 4)), (c) => c.charCodeAt(0))
}

/** `base` is the editor's address without any `#…`. */
export function encodeLink(payload: SharePayload, base: string): string {
  const bytes = deflateSync(new TextEncoder().encode(JSON.stringify(payload)), { level: 9 })
  return `${base}#${HASH_KEY}${toBase64Url(bytes)}`
}

export const isPlayHash = (hash: string): boolean => hash.replace(/^#/, '').startsWith(HASH_KEY)

/** Unpacked size limit of a link: a few kilobytes can unpack to gigabytes, so the unpacking stops early. */
const MAX_UNPACKED = 40 * 1024 * 1024

function inflateLimited(data: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = []
  let total = 0
  const stream = new Inflate((chunk) => {
    total += chunk.length
    if (total > MAX_UNPACKED) throw new ShareError('too large')
    chunks.push(chunk)
  })
  stream.push(data, true)
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) (out.set(chunk, at), (at += chunk.length))
  return out
}

const str = (v: unknown, max = 200): string => (typeof v === 'string' && v.length <= max ? v : '')

/** Reads and checks a link's payload; the link comes from anybody, so every part is validated. */
export function decodePayload(hash: string): SharePayload {
  const text = hash.replace(/^#/, '')
  if (!text.startsWith(HASH_KEY)) throw new ShareError('no game in this link')
  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder().decode(inflateLimited(fromBase64Url(text.slice(HASH_KEY.length)))))
  } catch (error) {
    throw error instanceof ShareError ? error : new ShareError('the link is damaged')
  }
  if (typeof raw !== 'object' || raw === null) throw new ShareError('the link is damaged')
  const r = raw as Record<string, unknown>
  if (r.v !== 1) throw new ShareError('this link was made by a newer editor')
  if (typeof r.files !== 'object' || r.files === null || Array.isArray(r.files)) throw new ShareError('the link has no files')
  const entries = Object.entries(r.files as Record<string, unknown>)
  if (entries.length > MAX_ZIP_FILES) throw new ShareError('too many files')
  const files: Record<string, FileContent> = {}
  let size = 0
  for (const [rawPath, value] of entries) {
    let path: string
    try {
      path = normalizePath(rawPath)
    } catch {
      throw new ShareError(`invalid path "${rawPath}"`)
    }
    if (EXCLUDED.test(path)) continue
    if (typeof value === 'string') size += value.length
    else if (typeof value === 'object' && value !== null && typeof (value as { base64?: unknown }).base64 === 'string') {
      const base64 = (value as { base64: string }).base64
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 !== 0) throw new ShareError(`"${rawPath}" is not valid`)
      size += base64.length
    } else throw new ShareError(`"${rawPath}" is not valid`)
    if (size > MAX_ZIP_BYTES) throw new ShareError('too large')
    files[path] = value as FileContent
  }
  const imagePaths = (list: unknown): string[] =>
    Array.isArray(list)
      ? list.flatMap((p) => {
          try {
            const path = normalizePath(String(p))
            return isImagePath(path) && !EXCLUDED.test(path) ? [path] : []
          } catch {
            return []
          }
        })
      : []
  const library = Array.isArray(r.library)
    ? r.library.flatMap((l) => {
        const item = l as { path?: unknown; id?: unknown }
        const [path] = imagePaths([item?.path])
        return path && str(item?.id) ? [{ path, id: str(item.id) }] : []
      })
    : []
  return {
    v: 1,
    name: str(r.name) || 'Spiel',
    miniworlds: str(r.miniworlds, 40) || null,
    packages: Array.isArray(r.packages) ? r.packages.filter((p): p is string => typeof p === 'string' && p.length <= 100).slice(0, 20) : [],
    files,
    library,
    withheld: imagePaths(r.withheld),
    shared: imagePaths(r.shared),
  }
}

export interface Renderers {
  /** Bytes of the library picture, or null for an id this editor does not know. */
  library(id: string): Promise<Uint8Array | null>
  placeholder(): Promise<Uint8Array>
}

/** The files to run: the payload's own, the library pictures drawn again, a placeholder for each withheld picture. */
export async function materialize(payload: SharePayload, render: Renderers): Promise<Record<string, Uint8Array>> {
  const out: Record<string, Uint8Array> = {}
  for (const [path, content] of Object.entries(payload.files)) {
    const data = decodeContent(content)
    out[path] = typeof data === 'string' ? new TextEncoder().encode(data) : data
  }
  for (const { path, id } of payload.library) out[path] = (await render.library(id)) ?? (await render.placeholder())
  if (payload.withheld.length > 0) {
    const placeholder = await render.placeholder()
    for (const path of payload.withheld) out[path] = placeholder
  }
  return out
}

/** Which kinds of pictures a payload carries, for the credits line of the play page. */
export function creditKinds(payload: SharePayload): { library: boolean; shared: boolean; withheld: boolean } {
  return { library: payload.library.length > 0, shared: payload.shared.length > 0, withheld: payload.withheld.length > 0 }
}

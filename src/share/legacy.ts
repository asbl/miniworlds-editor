/**
 * Reader for the first kind of project link, `#project=v1.…` (an editor release of 2026-11-18 made them; the editor no longer
 * creates them, the share dialog makes `#play=` links). Such links were handed out, so they must keep opening: a fresh local
 * copy of the project is made, nothing runs.
 */
import { Gunzip } from 'fflate'
import { normalizePath } from '../workspace/types'
import { validateProjectName, type ProjectStore } from '../workspace'
import { JUNK } from '../project/zip'

const MAX_SHARE_URL = 64 * 1024
const MAX_SHARE_BYTES = 5 * 1024 * 1024
const MAX_SHARE_FILES = 100
const MAX_JSON_BYTES = 8 * 1024 * 1024
const PREFIX = '#project='
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0)
  return c >>> 0
})

export class LegacyLinkError extends Error {
  constructor(readonly code: 'too-large' | 'too-many-files' | 'invalid' | 'version') { super(code) }
}

function decode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) throw new LegacyLinkError('invalid')
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

interface SharedProject { name: string; files: { path: string; data: string }[] }

export function hasLegacyLink(hash: string): boolean { return hash.startsWith(PREFIX) }

/** Bounded streaming inflation: never trust the gzip trailer's declared output size. */
function unpack(bytes: Uint8Array): unknown {
  if (bytes.length < 18 || bytes[0] !== 31 || bytes[1] !== 139 || bytes[2] !== 8) throw new LegacyLinkError('invalid')
  const chunks: Uint8Array[] = []
  let total = 0
  const gunzip = new Gunzip((chunk) => {
    total += chunk.length
    if (total > MAX_JSON_BYTES) throw new LegacyLinkError('too-large')
    chunks.push(chunk)
  })
  for (let i = 0; i < bytes.length; i += 256) gunzip.push(bytes.subarray(i, i + 256), i + 256 >= bytes.length)
  if (!bytes.length) throw new LegacyLinkError('invalid')
  const json = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { json.set(chunk, offset); offset += chunk.length }
  // Gunzip does not validate the trailer. Reject truncated or corrupted links even when their JSON still parses.
  const trailer = new DataView(bytes.buffer, bytes.byteOffset + bytes.length - 8, 8)
  let crc = 0xffffffff
  for (const byte of json) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 255]!
  if (trailer.getUint32(0, true) !== ((crc ^ 0xffffffff) >>> 0) || trailer.getUint32(4, true) !== total) throw new LegacyLinkError('invalid')
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json))
}

/** Validate the complete snapshot before creating or writing any project. Always make a fresh local copy. */
export async function importLegacyLink(store: ProjectStore, hash: string): Promise<string> {
  let name: string
  const files = new Map<string, Uint8Array>()
  try {
    if (hash.length > MAX_SHARE_URL) throw new LegacyLinkError('too-large')
    if (!hasLegacyLink(hash)) throw new LegacyLinkError('invalid')
    const payload = hash.slice(PREFIX.length)
    if (!payload.startsWith('v1.')) throw new LegacyLinkError('version')
    const project = unpack(decode(payload.slice(3))) as SharedProject
    if (!project || typeof project.name !== 'string' || !Array.isArray(project.files) || !project.files.length) throw new LegacyLinkError('invalid')
    name = validateProjectName(project.name)
    if (project.files.length > MAX_SHARE_FILES) throw new LegacyLinkError('too-many-files')
    let total = 0
    for (const file of project.files) {
      if (!file || typeof file.path !== 'string' || typeof file.data !== 'string') throw new LegacyLinkError('invalid')
      const path = normalizePath(file.path)
      if (path !== file.path || path.startsWith('/') || /[\\\u0000-\u001f]/.test(path) || files.has(path) || JUNK.test(path)) throw new LegacyLinkError('invalid')
      const bytes = decode(file.data)
      total += bytes.length
      if (total > MAX_SHARE_BYTES) throw new LegacyLinkError('too-large')
      files.set(path, bytes)
    }
    for (const path of files.keys()) {
      const parts = path.split('/')
      for (let i = 1; i < parts.length; i++) if (files.has(parts.slice(0, i).join('/'))) throw new LegacyLinkError('invalid')
    }
  } catch (error) {
    if (error instanceof LegacyLinkError) throw error
    throw new LegacyLinkError('invalid')
  }
  const stem = name.slice(0, 56)
  let next = stem
  for (let n = 2; await store.exists(next); n++) next = `${stem} ${n}`
  try {
    const { fs } = await store.open(next)
    for (const [path, bytes] of files) await fs.write(path, bytes)
  } catch (error) {
    await store.remove(next).catch(() => {})
    throw error
  }
  return next
}

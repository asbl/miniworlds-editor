import { Gunzip, gzipSync } from 'fflate'
import { normalizePath } from '../workspace/types'
import { validateProjectName, type Fs, type ProjectStore } from '../workspace'
import { JUNK } from './zip'

/** Application limits, not a promise that every messenger accepts links of this length. */
export const MAX_SHARE_URL = 64 * 1024
export const SHARE_URL_WARNING = 8000
export const MAX_SHARE_BYTES = 5 * 1024 * 1024
export const MAX_SHARE_FILES = 100
const MAX_JSON_BYTES = 8 * 1024 * 1024
const PREFIX = '#project='
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0)
  return c >>> 0
})

export class ShareError extends Error {
  constructor(readonly code: 'too-large' | 'too-many-files' | 'invalid' | 'version') { super(code) }
}

function encode(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) throw new ShareError('invalid')
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

interface SharedProject { name: string; files: { path: string; data: string }[] }

/** Snapshot of all project files, including binary assets; history is deliberately outside the project Fs. */
export async function createShareUrl(fs: Fs, name: string, href: string): Promise<string> {
  const files: SharedProject['files'] = []
  let total = 0
  for (const entry of await fs.list()) {
    if (entry.kind !== 'file' || JUNK.test(entry.path)) continue
    if (files.length >= MAX_SHARE_FILES) throw new ShareError('too-many-files')
    const bytes = await fs.readBytes(entry.path)
    total += bytes.length
    if (total > MAX_SHARE_BYTES) throw new ShareError('too-large')
    files.push({ path: entry.path, data: encode(bytes) })
  }
  if (!files.length) throw new ShareError('invalid')
  const json = new TextEncoder().encode(JSON.stringify({ name: validateProjectName(name), files }))
  if (json.length > MAX_JSON_BYTES) throw new ShareError('too-large')
  const url = new URL(href)
  // Launch/embed parameters must not cause a second import or send a shared task to another app mode.
  url.search = ''
  url.hash = `project=v1.${encode(gzipSync(json, { mtime: 0 }))}`
  if (url.href.length > MAX_SHARE_URL) throw new ShareError('too-large')
  return url.href
}

export function hasSharedProject(hash: string): boolean { return hash.startsWith(PREFIX) }

/** Bounded streaming inflation: never trust the gzip trailer's declared output size. */
function unpack(bytes: Uint8Array): unknown {
  if (bytes.length < 18 || bytes[0] !== 31 || bytes[1] !== 139 || bytes[2] !== 8) throw new ShareError('invalid')
  const chunks: Uint8Array[] = []
  let total = 0
  const gunzip = new Gunzip((chunk) => {
    total += chunk.length
    if (total > MAX_JSON_BYTES) throw new ShareError('too-large')
    chunks.push(chunk)
  })
  for (let i = 0; i < bytes.length; i += 256) gunzip.push(bytes.subarray(i, i + 256), i + 256 >= bytes.length)
  if (!bytes.length) throw new ShareError('invalid')
  const json = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { json.set(chunk, offset); offset += chunk.length }
  // Gunzip does not validate the trailer. Reject truncated or corrupted links even when their JSON still parses.
  const trailer = new DataView(bytes.buffer, bytes.byteOffset + bytes.length - 8, 8)
  let crc = 0xffffffff
  for (const byte of json) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 255]!
  if (trailer.getUint32(0, true) !== ((crc ^ 0xffffffff) >>> 0) || trailer.getUint32(4, true) !== total) throw new ShareError('invalid')
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json))
}

/** Validate the complete snapshot before creating or writing any project. Always make a fresh local copy. */
export async function importSharedProject(store: ProjectStore, hash: string): Promise<string> {
  let name: string
  const files = new Map<string, Uint8Array>()
  try {
    if (hash.length > MAX_SHARE_URL) throw new ShareError('too-large')
    if (!hasSharedProject(hash)) throw new ShareError('invalid')
    const payload = hash.slice(PREFIX.length)
    if (!payload.startsWith('v1.')) throw new ShareError('version')
    const project = unpack(decode(payload.slice(3))) as SharedProject
    if (!project || typeof project.name !== 'string' || !Array.isArray(project.files) || !project.files.length) throw new ShareError('invalid')
    name = validateProjectName(project.name)
    if (project.files.length > MAX_SHARE_FILES) throw new ShareError('too-many-files')
    let total = 0
    for (const file of project.files) {
      if (!file || typeof file.path !== 'string' || typeof file.data !== 'string') throw new ShareError('invalid')
      const path = normalizePath(file.path)
      if (path !== file.path || path.startsWith('/') || /[\\\u0000-\u001f]/.test(path) || files.has(path) || JUNK.test(path)) throw new ShareError('invalid')
      const bytes = decode(file.data)
      total += bytes.length
      if (total > MAX_SHARE_BYTES) throw new ShareError('too-large')
      files.set(path, bytes)
    }
    for (const path of files.keys()) {
      const parts = path.split('/')
      for (let i = 1; i < parts.length; i++) if (files.has(parts.slice(0, i).join('/'))) throw new ShareError('invalid')
    }
  } catch (error) {
    if (error instanceof ShareError) throw error
    throw new ShareError('invalid')
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

/** What every part of the UI may import about "work together" without loading the sync engine (Yjs is loaded when it is first needed). */
import type { Fs } from '../workspace'

export const MAX_NAME = 24

export function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME) || 'Gast'
}

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

function token(length: number, random?: () => number): string {
  if (random) return Array.from({ length }, () => ALPHABET[Math.floor(random() * ALPHABET.length)]).join('')
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')
}

/** `abcd-efgh`: names a room on the relay (not secret by itself). */
export function randomRoomCode(random?: () => number): string {
  return `${token(4, random)}-${token(4, random)}`
}

/**
 * What a link carries: the room, the key that allows writing and the key that allows reading only (the latter is what
 * a teacher gets). A read-only invitation holds the read key alone.
 */
export interface Invite {
  room: string
  /** The key this person connects with. */
  key: string
  /** The read key of the room (known to everybody who can write, so that they can hand out a read-only link). */
  readKey: string | null
  readOnly: boolean
}

export function newInvite(random?: () => number): Invite {
  return { room: randomRoomCode(random), key: token(12, random), readKey: token(12, random), readOnly: false }
}

const ROOM = '[a-z0-9]{4,12}(?:-[a-z0-9]{4,12}){0,3}'
const KEY = '[a-z0-9]{6,32}'

/** The text that goes behind `#room=` (write) or `#watch=` (read). */
export function inviteCode(invite: Invite): string {
  return invite.readOnly ? `${invite.room}.${invite.key}` : `${invite.room}.${invite.key}${invite.readKey ? `.${invite.readKey}` : ''}`
}

/** The write invitation of a session, as a read-only one (what the teacher link carries). */
export const readOnlyOf = (invite: Invite): Invite | null => (invite.readKey ? { room: invite.room, key: invite.readKey, readKey: invite.readKey, readOnly: true } : null)

/** `#room=abcd-efgh.KEY.READKEY` or `#watch=abcd-efgh.READKEY` → the invitation; null for anything else. */
export function parseInviteHash(hash: string): Invite | null {
  const write = new RegExp(`^#room=(${ROOM})\\.(${KEY})(?:\\.(${KEY}))?$`, 'i').exec(hash)
  if (write) return { room: (write[1] as string).toLowerCase(), key: write[2] as string, readKey: write[3] ?? null, readOnly: false }
  const read = new RegExp(`^#watch=(${ROOM})\\.(${KEY})$`, 'i').exec(hash)
  if (read) return { room: (read[1] as string).toLowerCase(), key: read[2] as string, readKey: read[2] as string, readOnly: true }
  return null
}

/** What a project remembers about its session: the invitation, the way it is written in a link. */
export function serializeInvite(invite: Invite): string {
  return `${invite.readOnly ? 'watch' : 'room'}:${inviteCode(invite)}`
}

export function deserializeInvite(text: string | null): Invite | null {
  if (!text) return null
  const [kind, code] = [text.slice(0, text.indexOf(':')), text.slice(text.indexOf(':') + 1)]
  return parseInviteHash(`#${kind === 'watch' ? 'watch' : 'room'}=${code}`)
}

export const roomLink = (invite: Invite, base: string): string => `${base}#${invite.readOnly ? 'watch' : 'room'}=${inviteCode(invite)}`

export type CollabFailure = 'full' | 'serverFull' | 'refused' | 'tooMany' | 'badRoom' | 'notFound' | 'busy' | 'tooBig' | 'network'

/** The close codes of the relay (see deploy/collab/relay.mjs) and the standard ones that mean something to the person. */
export function failureOfClose(code: number): CollabFailure | null {
  switch (code) {
    case 4001: return 'full'
    case 4002: return 'serverFull'
    case 4003: return 'refused'
    case 4004: return 'tooMany'
    case 4005: return 'badRoom'
    case 4006: return 'notFound'
    case 1008: return 'busy'
    case 1009: return 'tooBig'
    default: return null
  }
}

/** Failures where trying again at once is pointless (the person has to change something). */
export const FINAL_FAILURES: ReadonlySet<CollabFailure> = new Set(['refused', 'badRoom', 'notFound', 'tooBig'])

export interface Person {
  id: number
  name: string
  color: string
  self: boolean
  readOnly: boolean
  /** The file and line this person is working at. */
  focus: { path: string; line: number } | null
}

/** What other people changed in the project since the last call (already written to the file system). */
export interface RemoteChange {
  written: string[]
  removed: string[]
  /** The file was created anew by someone else (two people made the same name at once): an editor bound to the old text must reload. */
  replaced: string[]
}

/** A file system that also feeds the room; `mirror` is what the editor's autosave writes through (it never overrides the room). */
export interface SyncedFs extends Fs {
  readonly mirror: Fs
}

export const isSyncedFs = (fs: Fs): fs is SyncedFs => 'mirror' in fs

/** Files bigger than this stay on the device of the person who has them (see docs/collab.md). */
export const MAX_SHARED_BYTES = 3 * 1024 * 1024
/** All shared files together: everybody who joins downloads them all. */
export const MAX_SHARED_TOTAL = 24 * 1024 * 1024

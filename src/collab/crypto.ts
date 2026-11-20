/**
 * What keeps the relay from reading the project: every message is encrypted in the browser (AES-GCM) with a key that only
 * exists in the invitation link. The part of a link after `#` never goes to a server, not even to the one that serves the page.
 */
const enc = new TextEncoder()

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

/** The key of a room: from the secret of the invitation (long and random, so a plain hash is enough). */
export async function roomKey(secret: string, room: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(`miniworlds-collab-v1|${room}|${secret}`))
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

/** iv + ciphertext. The room name is authenticated too, so a message cannot be carried over into another room. */
export async function seal(key: CryptoKey, room: string, plain: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(room) }, key, plain as BufferSource))
  const out = new Uint8Array(12 + data.length)
  out.set(iv, 0)
  out.set(data, 12)
  return out
}

/** Throws when the message was not made with this key (wrong link, or tampered with). */
export async function open(key: CryptoKey, room: string, sealed: Uint8Array): Promise<Uint8Array> {
  if (sealed.length < 28) throw new Error('short')
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.subarray(0, 12) as unknown as BufferSource, additionalData: enc.encode(room) }, key, sealed.subarray(12) as unknown as BufferSource)
  return new Uint8Array(plain)
}

// ---- short codes ----------------------------------------------------------------------------------------------------------

const CONSONANTS = 'bdfgklmnprstvz'
const VOWELS = 'aeiou'

/** `kobi-latu-42`: easy to say across a classroom. About 31 bits, which is why a code only opens the door for a few hours (see docs/collab.md). */
export function newShortCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9))
  let i = 0
  const syl = () => `${CONSONANTS[(bytes[i++] as number) % CONSONANTS.length]}${VOWELS[(bytes[i++] as number) % VOWELS.length]}`
  return `${syl()}${syl()}-${syl()}${syl()}-${(bytes[i] as number) % 100}`.replace(/-(\d)$/, '-0$1')
}

/** What people type: any case, spaces or dots instead of dashes. Null when it cannot be a short code. */
export function parseShortCode(text: string): string | null {
  const t = text.trim().toLowerCase().replace(/[\s._]+/g, '-')
  return /^[bdfgklmnprstvz][aeiou][bdfgklmnprstvz][aeiou]-[bdfgklmnprstvz][aeiou][bdfgklmnprstvz][aeiou]-\d{2}$/.test(t) ? t : null
}

/**
 * From a code: the number under which the relay keeps the sealed invitation, and the key that seals it. Both come out of one slow
 * derivation (PBKDF2), so that whoever runs the relay cannot go through all codes quickly, neither by their lookup numbers nor by
 * trying to open what is stored.
 */
export async function fromCode(code: string): Promise<{ lookup: string; key: CryptoKey }> {
  const base = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveBits'])
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('miniworlds-code-v2'), iterations: 300_000 }, base, 384))
  return { lookup: hex(bits.subarray(0, 16)), key: await crypto.subtle.importKey('raw', bits.subarray(16) as unknown as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']) }
}

export async function sealWithCode(derived: { key: CryptoKey }, text: string): Promise<Uint8Array<ArrayBuffer>> {
  return seal(derived.key, 'code', enc.encode(text))
}

export async function openWithCode(derived: { key: CryptoKey }, sealed: Uint8Array): Promise<string> {
  return new TextDecoder().decode(await open(derived.key, 'code', sealed))
}

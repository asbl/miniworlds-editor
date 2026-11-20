import { codeLookup, newShortCode, openWithCode, sealWithCode } from './crypto'
import { deserializeInvite, parseInviteHash, serializeInvite, type Invite } from './shared'

/** How long the relay keeps a short code (see deploy/collab/relay.mjs). */
export const CODE_HOURS = 4

const web = (base: string) => base.replace(/^ws/, 'http').replace(/\/+$/, '')

export type CodeError = 'tooMany' | 'network'

/**
 * A short code stands for an invitation: the relay keeps the invitation sealed with the code (it cannot read it) for a few
 * hours, and the code never leaves the browser, only a lookup number derived from it does. Returns the code.
 */
export async function publishCode(base: string, invite: Invite): Promise<string> {
  for (let tries = 0; tries < 6; tries++) {
    const code = newShortCode()
    const body = await sealWithCode(code, serializeInvite(invite))
    const res = await fetch(`${web(base)}/code/${await codeLookup(code)}`, { method: 'PUT', body, headers: { 'content-type': 'application/octet-stream' } }).catch(() => null)
    if (!res) throw new Error('network' satisfies CodeError)
    if (res.status === 201) return code
    if (res.status === 429) throw new Error('tooMany' satisfies CodeError)
    if (res.status !== 409) throw new Error('network' satisfies CodeError) // 409: taken, draw another
  }
  throw new Error('network' satisfies CodeError)
}

/** The invitation behind a short code; null when there is none (wrong, or older than a few hours). */
export async function resolveCode(base: string, code: string): Promise<Invite | null> {
  const res = await fetch(`${web(base)}/code/${await codeLookup(code)}`, { cache: 'no-store' }).catch(() => null)
  if (!res) throw new Error('network' satisfies CodeError)
  if (res.status === 404) return null
  if (res.status === 429) throw new Error('tooMany' satisfies CodeError)
  if (!res.ok) throw new Error('network' satisfies CodeError)
  try {
    return deserializeInvite(await openWithCode(code, new Uint8Array(await res.arrayBuffer())))
  } catch {
    return null
  }
}

/** What a person types into "join": a short code, or a whole invitation link. */
export function inviteInLink(text: string): Invite | null {
  const at = text.indexOf('#')
  return at >= 0 ? parseInviteHash(text.slice(at).trim()) : null
}

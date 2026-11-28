/**
 * The fragment `#lti=…` carries a short-lived assertion from the LTI service (`docs/lti.md`).
 * A fragment never reaches a server — in contrast to a query — so the assertion stays between
 * Moodle, this browser and the backend. It is read once at startup and removed at once.
 */

const KEY = 'lti'

function entries(hash: string): [string, string][] {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  return raw.split('&').filter(Boolean).map(part => {
    const at = part.indexOf('=')
    return at < 0 ? [part, ''] : [part.slice(0, at), part.slice(at + 1)]
  })
}

/** The assertion from the address, or null when there is none. */
export function ltiAssertion(hash: string): string | null {
  for (const [key, value] of entries(hash)) if (key === KEY && value) return decodeURIComponent(value.replace(/\+/g, ' '))
  return null
}

/** The address without the assertion; everything else in the fragment (`#play=`, ...) stays. */
export function withoutLti(hash: string): string {
  const rest = entries(hash).filter(([key]) => key !== KEY).map(([key, value]) => (value ? `${key}=${value}` : key))
  return rest.length ? `#${rest.join('&')}` : ''
}


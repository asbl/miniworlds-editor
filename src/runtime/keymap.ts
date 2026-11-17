/**
 * The worker has no DOM, so keyboard/mouse input is forwarded and injected with pygame.event.post (see PLAN S3).
 * pygame key codes: printable keys use their ASCII code, special keys SDL scancode | (1 << 30).
 */
const SCANCODE = (n: number) => (1 << 30) | n

const BY_KEY: Record<string, number> = {
  Enter: 13,
  Escape: 27,
  Backspace: 8,
  Tab: 9,
  ' ': 32,
  Delete: 127,
  ArrowRight: SCANCODE(79),
  ArrowLeft: SCANCODE(80),
  ArrowDown: SCANCODE(81),
  ArrowUp: SCANCODE(82),
  Home: SCANCODE(74),
  End: SCANCODE(77),
  PageUp: SCANCODE(75),
  PageDown: SCANCODE(78),
  Insert: SCANCODE(73),
  CapsLock: SCANCODE(57),
}
// Left/right variants are distinguished by `code`.
const BY_CODE: Record<string, number> = {
  ShiftLeft: SCANCODE(225),
  ShiftRight: SCANCODE(229),
  ControlLeft: SCANCODE(224),
  ControlRight: SCANCODE(228),
  AltLeft: SCANCODE(226),
  AltRight: SCANCODE(230),
  MetaLeft: SCANCODE(227),
  MetaRight: SCANCODE(231),
}

export interface KeyLike {
  key: string
  code: string
  shiftKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  metaKey?: boolean
}

/** pygame key code for a DOM keyboard event, or null if the key has no pygame equivalent. */
export function toPygameKey(e: Pick<KeyLike, 'key' | 'code'>): number | null {
  const byCode = BY_CODE[e.code]
  if (byCode !== undefined) return byCode
  const special = BY_KEY[e.key]
  if (special !== undefined) return special
  const fn = /^F(\d{1,2})$/.exec(e.key)
  if (fn) {
    const n = Number(fn[1])
    if (n >= 1 && n <= 12) return SCANCODE(57 + n)
    return null
  }
  if ([...e.key].length === 1) {
    const unit = e.key.toLowerCase().charCodeAt(0)
    if (unit < 128) return unit // letters in lower case, digits and ASCII symbols as typed
  }
  return null
}

/** pygame KMOD_* bit mask: shift 1, ctrl 64, alt 256, meta 1024. */
export function toPygameMod(e: KeyLike): number {
  return (e.shiftKey ? 1 : 0) | (e.ctrlKey ? 64 : 0) | (e.altKey ? 256 : 0) | (e.metaKey ? 1024 : 0)
}

/** The typed character for KEYDOWN's `unicode` field ('' for non-printing keys). */
export function toUnicode(e: Pick<KeyLike, 'key'>): string {
  return [...e.key].length === 1 ? e.key : ''
}

/** DOM mouse button (0 left, 1 middle, 2 right) → pygame button (1, 2, 3). */
export const toPygameButton = (domButton: number): number => (domButton === 1 ? 2 : domButton === 2 ? 3 : 1)

/** Number literals in Python source, as the editor lets a pupil change them with a slider or the keyboard. */

const PLAIN = /^-?\d+(\.\d+)?$/

export interface NumberInfo {
  value: number
  /** Digits after the point; 0 for an integer. */
  decimals: number
  isFloat: boolean
}

/** Plain decimal literals only (`5`, `-3`, `0.25`); hex, exponents, `1_000` and `3j` are left alone. */
export function parseNumber(text: string): NumberInfo | null {
  if (!PLAIN.test(text)) return null
  const dot = text.indexOf('.')
  return { value: Number(text), decimals: dot === -1 ? 0 : text.length - dot - 1, isFloat: dot !== -1 }
}

/** One step of the slider or an arrow key: 1 for an integer, the last digit for a decimal number (0.25 → 0.01). */
export function stepOf(info: NumberInfo): number {
  return info.isFloat ? Number((10 ** -info.decimals).toFixed(info.decimals)) : 1
}

/** `text` moved by `steps` steps (times `factor`), written the same way: same number of decimals, no "-0". */
export function shifted(text: string, steps: number, factor = 1): string | null {
  const info = parseNumber(text)
  if (!info) return null
  return format(info.value + steps * factor * stepOf(info), info)
}

/** `value` written like the literal it replaces. */
export function format(value: number, like: NumberInfo): string {
  const out = like.isFloat ? value.toFixed(like.decimals) : String(Math.round(value))
  return /^-0(\.0+)?$/.test(out) ? out.slice(1) : out
}

/** The slider for a number: centred on the value the pupil started with, wide enough to get somewhere. */
export function sliderRange(info: NumberInfo): { min: number; max: number; step: number } {
  const step = stepOf(info)
  const span = Math.max(10, Math.ceil(Math.abs(info.value) * 2))
  return { min: info.value - span, max: info.value + span, step }
}

const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
export const toHex = (rgb: readonly [number, number, number]) => `#${hex(rgb[0])}${hex(rgb[1])}${hex(rgb[2])}`

export function fromHex(value: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value)
  return m ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)] : null
}

/** Is the text before a tuple something that takes a colour? Keeps the swatch off `(1, 2, 3)` that is not a colour. */
export function looksLikeColor(before: string): boolean {
  return /colou?r|background|costume|fill|border|paint|\bbg\b/i.test(before)
}

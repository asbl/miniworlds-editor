/** The smallest single replacement that turns `before` into `after` (common start and end are kept). */
export function simpleDiff(before: string, after: string): { index: number; remove: number; insert: string } {
  let start = 0
  const max = Math.min(before.length, after.length)
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++
  let endBefore = before.length
  let endAfter = after.length
  while (endBefore > start && endAfter > start && before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)) {
    endBefore--
    endAfter--
  }
  // do not cut a surrogate pair in half
  const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff
  if (start > 0 && isHigh(before.charCodeAt(start - 1))) start--
  if (endBefore < before.length && endBefore > start && !isHigh(before.charCodeAt(endBefore - 1)) && before.charCodeAt(endBefore) >= 0xdc00 && before.charCodeAt(endBefore) <= 0xdfff) {
    endBefore++
    endAfter++
  }
  return { index: start, remove: endBefore - start, insert: after.slice(start, endAfter) }
}

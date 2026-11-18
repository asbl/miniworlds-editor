export type DiffLine = { kind: 'same' | 'add' | 'del'; text: string; /** 1-based line numbers in the old and new text (null where the line does not exist) */ oldNo: number | null; newNo: number | null }

/** Beyond this many cells the comparison would be slow: the texts are shown as fully replaced. */
const MAX_CELLS = 4_000_000

const lines = (text: string): string[] => (text === '' ? [] : text.split('\n'))

/** Line-based difference (longest common subsequence), old -> new. */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = lines(oldText)
  const b = lines(newText)
  // common start and end are cheap to peel off and make the table small for typical edits
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const out: DiffLine[] = []
  for (let i = 0; i < start; i++) out.push({ kind: 'same', text: a[i] as string, oldNo: i + 1, newNo: i + 1 })
  const x = a.slice(start, endA)
  const y = b.slice(start, endB)
  if (x.length * y.length > MAX_CELLS) {
    x.forEach((text, i) => out.push({ kind: 'del', text, oldNo: start + i + 1, newNo: null }))
    y.forEach((text, i) => out.push({ kind: 'add', text, oldNo: null, newNo: start + i + 1 }))
  } else {
    const n = x.length
    const m = y.length
    const table: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        (table[i] as Uint32Array)[j] = x[i] === y[j] ? ((table[i + 1] as Uint32Array)[j + 1] as number) + 1 : Math.max((table[i + 1] as Uint32Array)[j] as number, (table[i] as Uint32Array)[j + 1] as number)
    let i = 0
    let j = 0
    while (i < n || j < m) {
      if (i < n && j < m && x[i] === y[j]) {
        out.push({ kind: 'same', text: x[i] as string, oldNo: start + i + 1, newNo: start + j + 1 })
        i++
        j++
      } else if (j < m && (i === n || ((table[i] as Uint32Array)[j + 1] as number) > ((table[i + 1] as Uint32Array)[j] as number))) {
        out.push({ kind: 'add', text: y[j] as string, oldNo: null, newNo: start + j + 1 })
        j++
      } else {
        out.push({ kind: 'del', text: x[i] as string, oldNo: start + i + 1, newNo: null })
        i++
      }
    }
  }
  for (let k = 0; k < a.length - endA; k++) out.push({ kind: 'same', text: a[endA + k] as string, oldNo: endA + k + 1, newNo: endB + k + 1 })
  return out
}

export interface Hunk {
  lines: DiffLine[]
}

/** The changed parts with `context` unchanged lines around them (what a reader wants to see); [] when nothing differs. */
export function hunks(diff: readonly DiffLine[], context = 3): Hunk[] {
  const keep = new Array<boolean>(diff.length).fill(false)
  diff.forEach((line, i) => {
    if (line.kind === 'same') return
    for (let k = Math.max(0, i - context); k <= Math.min(diff.length - 1, i + context); k++) keep[k] = true
  })
  const out: Hunk[] = []
  let current: DiffLine[] | null = null
  diff.forEach((line, i) => {
    if (!keep[i]) {
      current = null
      return
    }
    if (!current) out.push({ lines: (current = []) })
    current.push(line)
  })
  return out
}

export const changeCount = (diff: readonly DiffLine[]): number => diff.filter((l) => l.kind !== 'same').length

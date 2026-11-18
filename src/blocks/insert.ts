export interface Block {
  id: string
  group: 'move' | 'input' | 'collide' | 'flow' | 'world'
  /** `statement` goes into the code at the cursor; `method` is a whole method and goes to the end of the class. */
  kind: 'statement' | 'method'
  imports?: string[]
  /** CodeMirror snippet syntax: `${1:default}` fields, Tab jumps to the next. */
  code: string
}

export const GROUPS: Block['group'][] = ['move', 'input', 'collide', 'flow', 'world']

/**
 * Where a block goes: replace `from`…`to` with `insert` (line breaks and indentation only), then start the snippet at
 * the end of that text. The snippet's further lines pick up the indentation of the line it starts in.
 */
export interface Anchor {
  from: number
  to: number
  insert: string
}

const leading = (line: string) => /^[ \t]*/.exec(line)![0]
const INDENT = '    '

/** Indentation for a new line below `line`: the same, one level deeper after a line that ends with ":". */
const below = (line: string) => leading(line) + (line.trimEnd().endsWith(':') ? INDENT : '')

/**
 * A statement block goes onto the cursor's line when that line is blank (indented like the code above it), otherwise onto
 * a new line below it, indented like it (one level deeper after a line that ends with ":").
 */
export function statementAnchor(doc: string, cursor: number): Anchor {
  const start = doc.lastIndexOf('\n', cursor - 1) + 1
  const nl = doc.indexOf('\n', cursor)
  const end = nl === -1 ? doc.length : nl
  const line = doc.slice(start, end)
  if (line.trim() !== '') return { from: end, to: end, insert: '\n' + below(line) }
  if (line.length > 0) return { from: start, to: end, insert: line } // an indented blank line keeps its indentation
  const lines = doc.slice(0, Math.max(0, start - 1)).split('\n')
  const previous = start === 0 ? undefined : [...lines].reverse().find((l) => l.trim() !== '')
  return { from: start, to: end, insert: previous === undefined ? '' : below(previous) }
}

/**
 * A method block goes to the end of the class the cursor is in (after its last non-blank line), after a blank line,
 * one level deep. Null when the cursor is not inside a class.
 */
export function methodAnchor(doc: string, cursor: number): Anchor | null {
  const lines = doc.split('\n')
  const starts: number[] = []
  let offset = 0
  for (const line of lines) {
    starts.push(offset)
    offset += line.length + 1
  }
  const at = Math.max(0, starts.findLastIndex((s) => s <= cursor))
  const here = lines[at] as string
  if (here.trim() !== '' && leading(here) === '' && !/^class\s/.test(here)) return null // the cursor is on a top-level statement
  let classLine = -1
  for (let i = at; i >= 0; i--) {
    const l = lines[i] as string
    if (/^class\s/.test(l)) {
      classLine = i
      break
    }
    if (i < at && l.trim() !== '' && leading(l) === '') return null // a top-level statement in between: not in a class
  }
  if (classLine === -1) return null
  let last = classLine
  for (let i = classLine + 1; i < lines.length; i++) {
    const l = lines[i] as string
    if (l.trim() === '') continue
    if (leading(l) === '') break
    last = i
  }
  const end = starts[last]! + (lines[last] as string).length
  return { from: end, to: end, insert: '\n\n' + INDENT }
}

/** The `import x` lines still missing and where they go: after the file's last leading import, else at the very top. */
export function importChange(doc: string, modules: readonly string[] | undefined): { from: number; insert: string } | null {
  const missing = (modules ?? []).filter((m) => !new RegExp(`^\\s*(import\\s+${m}\\b|from\\s+${m}\\b)`, 'm').test(doc))
  if (missing.length === 0) return null
  const text = missing.map((m) => `import ${m}\n`).join('')
  let after = 0
  let offset = 0
  for (const line of doc.split('\n')) {
    const next = offset + line.length + 1
    if (/^(import|from)\s/.test(line)) after = Math.min(next, doc.length)
    else if (line.trim() !== '' && !line.startsWith('#')) break
    offset = next
  }
  const lineBreak = after > 0 && !doc.slice(0, after).endsWith('\n') ? '\n' : ''
  return { from: after, insert: lineBreak + text }
}

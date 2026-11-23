import { parser } from '@lezer/python'
import type { SyntaxNode } from '@lezer/common'

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

/** Check the scope where the new statement will actually land, including blank lines and def headers. */
export function hasSelf(doc: string, anchor: Anchor): boolean {
  const at = anchor.from + anchor.insert.length
  const source = doc.slice(0, anchor.from) + anchor.insert + '__block__' + doc.slice(anchor.to)
  for (let node: SyntaxNode | null = parser.parse(source).resolveInner(at, 1); node; node = node.parent) {
    if (node.name === 'ClassDefinition') return false
    if (node.name === 'FunctionDefinition') {
      const params = node.getChild('ParamList')
      if (params?.getChildren('VariableName').some((p) => source.slice(p.from, p.to) === 'self')) return true
    }
  }
  return false
}

export interface RegisterTarget {
  name: string
  className: string
}

/** Top-level instances available before the world's blocking run() call. No Python worker required. */
export function registrationSite(doc: string): { targets: RegisterTarget[]; anchor: Anchor } {
  const instances = new Map<string, string>()
  let end = doc.length
  for (let node = parser.parse(doc).topNode.firstChild; node; node = node.nextSibling) {
    const text = doc.slice(node.from, node.to)
    if (node.name === 'ExpressionStatement' && /^\s*[\p{L}_][\p{L}\p{N}_]*\.run\s*\(/u.test(text)) {
      end = node.from
      break
    }
    if (node.name !== 'AssignStatement') continue
    const name = node.firstChild
    if (name?.name !== 'VariableName') continue
    const variable = doc.slice(name.from, name.to)
    instances.delete(variable) // a later assignment may no longer be an instance
    const call = node.lastChild
    if (call?.name !== 'CallExpression') continue
    const callee = call.firstChild
    if (!callee || !['VariableName', 'MemberExpression'].includes(callee.name)) continue
    const className = doc.slice(callee.from, callee.to)
    if (/^[\p{Lu}_][\p{L}\p{N}_]*$/u.test(className.split('.').at(-1)!)) instances.set(variable, className)
  }
  return {
    targets: [...instances].map(([name, className]) => ({ name, className })),
    anchor: { from: end, to: end, insert: (end > 0 ? (doc[end - 1] === '\n' ? '\n' : '\n\n') : '') },
  }
}

/** A registered handler stays at module level, after its object exists and before run(). */
export function registeredBlock(doc: string, block: Block, target: string): { anchor: Anchor; code: string } | null {
  const site = registrationSite(doc)
  if (block.kind !== 'method' || !site.targets.some((t) => t.name === target)) return null
  return { anchor: site.anchor, code: `@${target}.register\n${block.code}\n\n` }
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

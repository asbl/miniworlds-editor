import type { Lang } from '../i18n'
import type { EngineHint, JediItem, RuffDiagnostic } from './protocol'

/** One problem in the editor, from either source, in one shape. Lines 1-based, columns 0-based UTF-16. */
export interface Issue {
  line: number
  col: number
  endLine: number
  endCol: number
  severity: 'error' | 'warning' | 'info'
  message: string
  source: 'miniworlds' | 'ruff'
  code: string
  fix?: { label: string; edits: { line: number; col: number; endLine: number; endCol: number; text: string }[] }
}

export function engineHintToIssue(h: EngineHint, fixLabel: (replacement: string) => string): Issue {
  return {
    line: h.line,
    col: h.col,
    endLine: h.line,
    endCol: Math.max(h.end_col, h.col + 1),
    severity: h.severity,
    message: h.message,
    source: 'miniworlds',
    code: h.code,
    fix: h.replacement ? { label: fixLabel(h.replacement), edits: [{ line: h.line, col: h.col, endLine: h.line, endCol: Math.max(h.end_col, h.col + 1), text: h.replacement }] } : undefined,
  }
}

const quoted = (message: string) => /`([^`]+)`/.exec(message)?.[1] ?? ''

/** German texts for the ruff rules pupils meet most; everything else keeps ruff's English message. */
const GERMAN: Record<string, (m: string, name: string) => string> = {
  F821: (_m, n) => `Der Name „${n}“ ist nirgends definiert.`,
  F401: (_m, n) => `„${n}“ wird importiert, aber nie benutzt.`,
  F841: (_m, n) => `Die Variable „${n}“ bekommt einen Wert, wird aber nie benutzt.`,
  F811: (_m, n) => `„${n}“ wird neu definiert, ohne vorher benutzt worden zu sein.`,
  F541: () => 'f-String ohne Platzhalter: das „f“ davor ist überflüssig.',
  E701: () => 'Mehrere Anweisungen in einer Zeile (nach dem Doppelpunkt).',
  E702: () => 'Mehrere Anweisungen in einer Zeile (Semikolon).',
  E703: () => 'Überflüssiges Semikolon am Zeilenende.',
  E711: () => 'Vergleiche mit None besser mit „is None“ / „is not None“.',
  E712: () => 'Vergleiche mit True/False besser direkt oder mit „is“.',
  E722: () => '„except:“ ohne Fehlerart fängt alles – nenne die erwartete Fehlerart.',
  E741: (_m, n) => `Der Name „${n}“ ist leicht mit 1 oder I zu verwechseln.`,
  'invalid-syntax': (m) => `Syntaxfehler: ${m}`,
}

export function translateRuff(code: string | null, message: string, lang: Lang): string {
  const make = lang === 'de' ? GERMAN[code ?? 'invalid-syntax'] : undefined
  return make ? make(message, quoted(message)) : message
}

/** Pupils keep `from classes.X import X` in main.py on purpose (the miniworlds view sees only imported classes). */
const CLASS_IMPORT = /^\s*from\s+classes\.\w+\s+import\s+\w+/

export function ruffToIssues(diags: readonly RuffDiagnostic[], lines: readonly string[], lang: Lang, fixLabel: (label: string) => string): Issue[] {
  const out: Issue[] = []
  for (const d of diags) {
    const line = d.start_location.row
    if (d.code === 'F401' && CLASS_IMPORT.test(lines[line - 1] ?? '')) continue
    const syntax = d.code === null || d.code === 'invalid-syntax' || d.code.startsWith('E9')
    const code = d.code ?? 'invalid-syntax'
    out.push({
      line,
      col: Math.max(0, d.start_location.column - 1),
      endLine: d.end_location.row,
      endCol: Math.max(0, d.end_location.column - 1),
      severity: syntax || code === 'F821' ? 'error' : 'warning',
      message: translateRuff(code, d.message, lang),
      source: 'ruff',
      code,
      fix: d.fix?.edits.length
        ? {
            label: fixLabel(d.fix.message ?? ''),
            edits: d.fix.edits.map((e) => ({ line: e.location.row, col: Math.max(0, e.location.column - 1), endLine: e.end_location.row, endCol: Math.max(0, e.end_location.column - 1), text: e.content ?? '' })),
          }
        : undefined,
    })
  }
  return out
}

const overlaps = (a: Issue, b: Issue) => a.line <= b.endLine && b.line <= a.endLine && (a.line !== b.endLine || a.col < b.endCol) && (b.line !== a.endLine || b.col < a.endCol)

/** miniworlds hints are more specific (and German): ruff issues on the same spot are dropped. */
export function mergeIssues(engine: readonly Issue[], ruff: readonly Issue[]): Issue[] {
  const kept = ruff.filter((r) => !engine.some((e) => overlaps(e, r)))
  return [...engine, ...kept].sort((a, b) => a.line - b.line || a.col - b.col)
}

export interface CompletionItem {
  label: string
  type: string
  info?: string
  boost: number
  /** Insert "(" after the name (functions and methods). */
  call: boolean
}

const TYPE: Record<string, string> = {
  function: 'function',
  class: 'class',
  module: 'namespace',
  instance: 'variable',
  statement: 'variable',
  param: 'variable',
  keyword: 'keyword',
  property: 'property',
  path: 'text',
}

export function jediToItems(items: readonly JediItem[]): CompletionItem[] {
  return items.map((i) => ({
    label: i.name,
    type: TYPE[i.type] ?? 'text',
    info: i.doc || undefined,
    // private and dunder names last, keyword arguments (`name=`) right behind real members
    boost: i.name.startsWith('_') ? -9 : i.type === 'param' ? -1 : i.type === 'keyword' ? -2 : 0,
    call: i.type === 'function',
  }))
}

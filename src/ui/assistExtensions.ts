import { autocompletion, insertBracket, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { forceLinting, lintGutter, linter, type Action, type Diagnostic } from '@codemirror/lint'
import { syntaxTree } from '@codemirror/language'
import { hoverTooltip } from '@codemirror/view'
import { signatureHelp } from './signatureHelp'
import type { EditorView } from '@codemirror/view'
import type { Text } from '@codemirror/state'
import type { Assist } from '../language/assist'
import type { Issue } from '../language/convert'

const LINT_DELAY_MS = 700

/** Position in the document for a 1-based line and 0-based UTF-16 column, clamped to the line. */
export function offsetOf(doc: Text, line: number, col: number): number {
  const l = doc.line(Math.min(Math.max(line, 1), doc.lines))
  return Math.min(l.from + col, l.to)
}

export function issuesToDiagnostics(doc: Text, issues: readonly Issue[]): Diagnostic[] {
  return issues.map((issue) => {
    const from = offsetOf(doc, issue.line, issue.col)
    const to = Math.max(from + 1, offsetOf(doc, issue.endLine, issue.endCol))
    const actions: Action[] = []
    if (issue.fix) {
      const { label, edits } = issue.fix
      const relative = edits.map((e) => ({ from: offsetOf(doc, e.line, e.col) - from, to: offsetOf(doc, e.endLine, e.endCol) - from, insert: e.text }))
      actions.push({
        name: label,
        apply(view: EditorView, start: number) {
          // positions are relative to the diagnostic, which CodeMirror keeps in step with edits made in the meantime
          view.dispatch({ changes: relative.map((r) => ({ from: Math.max(0, start + r.from), to: Math.min(view.state.doc.length, start + r.to), insert: r.insert })) })
        },
      })
    }
    return { from, to: Math.min(to, doc.length), severity: issue.severity, message: issue.message, source: issue.source, actions }
  })
}

/** jedi counts code points, CodeMirror UTF-16 units: they differ after an emoji or other astral character. */
export const codePointCol = (text: string, col: number): number => Array.from(text.slice(0, col)).length

const inStringOrComment = (ctx: CompletionContext) => /String|Comment/.test(syntaxTree(ctx.state).resolveInner(ctx.pos, -1).name)

/** Everything the editor gets from the language service: completion, hints (lint), hover. */
export function assistExtensions(getAssist: () => Assist | null, getPath: () => string | null) {
  async function source(ctx: CompletionContext): Promise<CompletionResult | null> {
    const assist = getAssist()
    const path = getPath()
    if (!assist || !path || !path.endsWith('.py') || inStringOrComment(ctx)) return null
    const line = ctx.state.doc.lineAt(ctx.pos)
    const col = ctx.pos - line.from
    const word = ctx.matchBefore(/[\p{L}_][\p{L}\p{N}_]*/u)
    const afterDot = line.text.slice(0, col).endsWith('.')
    if (!ctx.explicit && !word && !afterDot) return null
    const items = await assist.complete(path, ctx.state.doc.toString(), line.number, codePointCol(line.text, col))
    if (ctx.aborted || items.length === 0) return null
    const options: Completion[] = items.map((i) => ({
      label: i.label,
      type: i.type,
      info: i.info,
      boost: i.boost,
      apply: i.call
        ? (view, _c, from, to) => {
            view.dispatch({ changes: { from, to, insert: i.label }, selection: { anchor: from + i.label.length } })
            // the bracket helper adds the closing one and lets the user type over it
            if (view.state.sliceDoc(from + i.label.length, from + i.label.length + 1) !== '(') {
              const tr = insertBracket(view.state, '(')
              if (tr) view.dispatch(tr)
            }
          }
        : i.label,
    }))
    return { from: word ? word.from : ctx.pos, options, validFor: /^[\p{L}\p{N}_]*$/u }
  }

  return [
    autocompletion({ override: [source], icons: true, maxRenderedOptions: 60 }),
    ...signatureHelp(getAssist, getPath),
    lintGutter(),
    linter(
      async (view) => {
        const assist = getAssist()
        const path = getPath()
        if (!assist || !path || !path.endsWith('.py')) return []
        return issuesToDiagnostics(view.state.doc, await assist.lint(path, view.state.doc.toString()))
      },
      { delay: LINT_DELAY_MS },
    ),
    hoverTooltip(async (view, pos) => {
      const assist = getAssist()
      const path = getPath()
      if (!assist || !path || !path.endsWith('.py')) return null
      const word = view.state.wordAt(pos)
      if (!word) return null
      const line = view.state.doc.lineAt(word.from)
      const info = await assist.hover(path, view.state.doc.toString(), line.number, codePointCol(line.text, word.from - line.from + (pos > word.from ? Math.min(pos - word.from, word.to - word.from) : 0)))
      if (!info) return null
      return {
        pos: word.from,
        end: word.to,
        above: true,
        create() {
          const dom = document.createElement('div')
          dom.className = 'cm-hover-doc'
          const pre = document.createElement('pre')
          pre.textContent = info.doc
          dom.append(pre)
          return { dom }
        },
      }
    }),
  ]
}

export { forceLinting }

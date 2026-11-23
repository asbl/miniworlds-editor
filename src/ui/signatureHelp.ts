import { StateEffect, StateField } from '@codemirror/state'
import { EditorView, keymap, showTooltip, ViewPlugin, type Tooltip } from '@codemirror/view'
import type { Assist } from '../language/assist'
import type { Signature } from '../language/protocol'

interface Shown {
  pos: number
  info: Signature
}

const setSignature = StateEffect.define<Shown | null>()
const DELAY_MS = 150

const MAX_PARAMS = 7

/** Which params to show: all when there are few, otherwise a window around the one being typed (from the start when none is). */
export function visibleParams(params: readonly string[], index: number | null, max = MAX_PARAMS): { start: number; end: number } {
  if (params.length <= max) return { start: 0, end: params.length }
  const current = index === null ? 0 : Math.min(Math.max(index, 0), params.length - 1)
  const start = Math.min(Math.max(current - (max >> 1), 0), params.length - max)
  return { start, end: start + max }
}

/** A call's parameters as small text: `move(distance=1)` with the one being typed in bold, plus its doc line. */
export function renderSignature(info: Signature): HTMLElement {
  const dom = document.createElement('div')
  dom.className = 'cm-signature'
  const name = document.createElement('span')
  name.textContent = `${info.name}(`
  dom.append(name)
  // *args and **kwargs take every further argument
  const current = info.index === null ? -1 : Math.min(info.index, info.params.length - 1)
  const { start, end } = visibleParams(info.params, info.index)
  const parts: { text: string; active: boolean }[] = []
  if (start > 0) parts.push({ text: '…', active: false })
  info.params.slice(start, end).forEach((param, i) => parts.push({ text: param, active: start + i === current }))
  if (end < info.params.length) parts.push({ text: '…', active: false })
  parts.forEach((part, i) => {
    if (i > 0) dom.append(', ')
    const span = document.createElement('span')
    span.textContent = part.text
    if (part.active) span.className = 'cm-signature-active'
    dom.append(span)
  })
  dom.append(')')
  if (info.doc) {
    const doc = document.createElement('div')
    doc.className = 'cm-signature-doc'
    doc.textContent = info.doc
    dom.append(doc)
  }
  return dom
}

const field = StateField.define<Shown | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setSignature)) return effect.value
    return value && tr.docChanged ? { ...value, pos: tr.changes.mapPos(value.pos) } : value
  },
  provide: (f) =>
    showTooltip.compute([f], (state): Tooltip | null => {
      const shown = state.field(f)
      return shown ? { pos: shown.pos, above: true, strictSide: true, create: () => ({ dom: renderSignature(shown.info) }) } : null
    }),
})

/** While a call's arguments are typed, a tooltip shows the function's parameters (from jedi, in the language worker). */
export function signatureHelp(getAssist: () => Assist | null, getPath: () => string | null) {
  const plugin = ViewPlugin.fromClass(
    class {
      timer: ReturnType<typeof setTimeout> | null = null
      update(update: { docChanged: boolean; selectionSet: boolean; view: EditorView }) {
        if (!update.docChanged && !update.selectionSet) return
        if (this.timer) clearTimeout(this.timer)
        this.timer = setTimeout(() => void this.ask(update.view), DELAY_MS)
      }
      async ask(view: EditorView) {
        const assist = getAssist()
        const path = getPath()
        if (!assist || !path || !path.endsWith('.py')) return
        const { head, empty } = view.state.selection.main
        const showing = view.state.field(field, false) !== null
        const clear = () => showing && view.dispatch({ effects: setSignature.of(null) })
        if (!empty) return void clear()
        // only code with an opening bracket nearby can be inside a call: no request otherwise
        if (!showing && !view.state.doc.sliceString(Math.max(0, head - 300), head).includes('(')) return
        const line = view.state.doc.lineAt(head)
        const col = Array.from(line.text.slice(0, head - line.from)).length // jedi counts code points
        const info = await assist.signature(path, view.state.doc.toString(), line.number, col)
        if (view.state.selection.main.head !== head) return // typed on meanwhile: a newer request follows
        if (info && info.params.length > 0) view.dispatch({ effects: setSignature.of({ pos: head, info }) })
        else clear()
      }
      destroy() {
        if (this.timer) clearTimeout(this.timer)
      }
    },
  )
  return [
    field,
    plugin,
    keymap.of([
      {
        key: 'Escape',
        run: (view) => {
          if (view.state.field(field, false) === null) return false
          view.dispatch({ effects: setSignature.of(null) })
          return true
        },
      },
    ]),
  ]
}

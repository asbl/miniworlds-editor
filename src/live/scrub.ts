import { syntaxTree } from '@codemirror/language'
import { EditorState, StateField, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, hoverTooltip, keymap, WidgetType, type DecorationSet, type Tooltip } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { t } from '../i18n'
import { format, fromHex, looksLikeColor, parseNumber, shifted, sliderRange, toHex } from './numbers'

export interface Literal {
  from: number
  to: number
  text: string
}

/** The plain number under `pos`, with its minus sign when it has one (`-3` is one thing to the pupil). */
export function literalAt(state: EditorState, pos: number): Literal | null {
  const tree = syntaxTree(state)
  for (const side of [1, -1] as const) {
    const number: SyntaxNode = tree.resolveInner(pos, side)
    if (number.name !== 'Number') continue
    const parent = number.parent
    const from = parent?.name === 'UnaryExpression' && state.sliceDoc(parent.from, number.from).trim() === '-' ? parent.from : number.from
    const text = state.sliceDoc(from, number.to)
    if (parseNumber(text)) return { from, to: number.to, text }
  }
  return null
}

/** Changes a literal in place; returns where it ends now (so a slider can keep going). */
function replace(view: EditorView, literal: Literal, text: string): Literal {
  if (text === literal.text) return literal
  // "-3" after "**" would read as -(3**…): keep the minus inside the number's own parentheses
  const after = view.state.sliceDoc(literal.to, literal.to + 4).trimStart()
  const wrapped = text.startsWith('-') && !literal.text.startsWith('-') && after.startsWith('**') ? `(${text})` : text
  view.dispatch({ changes: { from: literal.from, to: literal.to, insert: wrapped }, userEvent: 'input.scrub' })
  return { from: literal.from, to: literal.from + wrapped.length, text: wrapped }
}

/** The slider that appears when the mouse rests on a number. */
function sliderTooltip(view: EditorView, start: Literal, onChange: () => void): Tooltip {
  const info = parseNumber(start.text) as NonNullable<ReturnType<typeof parseNumber>>
  let current = start
  return {
    pos: start.from,
    end: start.to,
    above: true,
    create(v) {
      const dom = document.createElement('div')
      dom.className = 'cm-num-tip'
      const { min, max, step } = sliderRange(info)
      const range = Object.assign(document.createElement('input'), { type: 'range', min: String(min), max: String(max), step: String(step), value: String(info.value) })
      range.setAttribute('aria-label', t('live.slider'))
      const out = document.createElement('output')
      out.textContent = start.text
      const apply = (value: number) => {
        const text = format(value, info)
        current = replace(v, current, text)
        out.textContent = text
        range.value = String(value)
        onChange()
      }
      const nudge = (by: number) => apply(Number(range.value) + by * step)
      const minus = Object.assign(document.createElement('button'), { type: 'button', textContent: '−', title: t('live.less') })
      const plus = Object.assign(document.createElement('button'), { type: 'button', textContent: '+', title: t('live.more') })
      minus.addEventListener('click', () => nudge(-1))
      plus.addEventListener('click', () => nudge(1))
      range.addEventListener('input', () => apply(Number(range.value)))
      dom.append(minus, range, plus, out)
      return { dom }
    },
  }
}

/** Colour swatch after a `(r, g, b)` that takes a colour; its picker writes the three numbers. */
class Swatch extends WidgetType {
  constructor(
    readonly rgb: readonly [number, number, number],
    private onChange: () => void,
  ) {
    super()
  }

  eq(other: Swatch): boolean {
    return other.rgb.join() === this.rgb.join()
  }

  toDOM(view: EditorView): HTMLElement {
    const input = Object.assign(document.createElement('input'), { type: 'color', value: toHex(this.rgb), className: 'cm-swatch' })
    input.setAttribute('aria-label', t('live.color'))
    input.title = t('live.color')
    input.addEventListener('input', () => {
      const rgb = fromHex(input.value)
      if (!rgb) return
      const at = view.posAtDOM(input)
      const tuple = tupleEndingAt(view.state, at)
      if (!tuple) return
      const changes = tuple.map((n, i) => ({ from: n.from, to: n.to, insert: String(rgb[i]) }))
      view.dispatch({ changes, userEvent: 'input.scrub' })
      this.onChange()
    })
    return input
  }

  // the picker stays open while its colour changes the text: update the element instead of replacing it
  updateDOM(dom: HTMLElement): boolean {
    if (!(dom instanceof HTMLInputElement) || dom.type !== 'color') return false
    if (dom.value !== toHex(this.rgb)) dom.value = toHex(this.rgb)
    return true
  }

  ignoreEvent(): boolean {
    return true
  }
}

function colorTuple(state: EditorState, node: SyntaxNode): SyntaxNode[] | null {
  if (node.name !== 'TupleExpression') return null
  const numbers: SyntaxNode[] = []
  for (let child = node.firstChild; child; child = child.nextSibling) if (child.name === 'Number') numbers.push(child)
  if (numbers.length !== 3) return null
  for (const n of numbers) {
    const text = state.sliceDoc(n.from, n.to)
    if (!/^\d{1,3}$/.test(text) || Number(text) > 255) return null
  }
  const line = state.doc.lineAt(node.from)
  return looksLikeColor(state.sliceDoc(line.from, node.from)) ? numbers : null
}

function tupleEndingAt(state: EditorState, pos: number): SyntaxNode[] | null {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1)
  while (node && !(node.name === 'TupleExpression' && node.to === pos)) node = node.parent
  return node ? colorTuple(state, node) : null
}

function swatches(state: EditorState, onChange: () => void): DecorationSet {
  const found: Range<Decoration>[] = []
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== 'TupleExpression') return
      const numbers = colorTuple(state, node.node)
      if (!numbers) return
      const rgb = numbers.map((n) => Number(state.sliceDoc(n.from, n.to))) as [number, number, number]
      found.push(Decoration.widget({ widget: new Swatch(rgb, onChange), side: 1 }).range(node.to))
    },
  })
  return Decoration.set(found, true)
}

const ARROWS = [
  { key: 'Mod-Shift-ArrowUp', by: 1, factor: 1 },
  { key: 'Mod-Shift-ArrowDown', by: -1, factor: 1 },
  { key: 'Mod-Shift-Alt-ArrowUp', by: 1, factor: 10 },
  { key: 'Mod-Shift-Alt-ArrowDown', by: -1, factor: 10 },
]

/**
 * Numbers in the code can be changed without typing: rest the mouse on one for a slider, drag it with Alt held, or press
 * Ctrl+Shift+Up/Down with the cursor in it. A `(r, g, b)` that takes a colour gets a colour picker. `onChange` runs after
 * every change (the page then applies it to the running world).
 */
export function numberTools(onChange: () => void): Extension {
  const swatchField = StateField.define<DecorationSet>({
    create: (state) => swatches(state, onChange),
    update: (value, tr) => (tr.docChanged || syntaxTree(tr.state) !== syntaxTree(tr.startState) ? swatches(tr.state, onChange) : value),
    provide: (field) => EditorView.decorations.from(field),
  })
  return [
    swatchField,
    hoverTooltip(
      (view, pos) => {
        const literal = literalAt(view.state, pos)
        return literal ? sliderTooltip(view, literal, onChange) : null
      },
      { hoverTime: 350 },
    ),
    keymap.of(
      ARROWS.map(({ key, by, factor }) => ({
        key,
        run: (view: EditorView) => {
          const literal = literalAt(view.state, view.state.selection.main.head)
          const text = literal && shifted(literal.text, by, factor)
          if (!literal || text === null) return false
          const next = replace(view, literal, text)
          view.dispatch({ selection: { anchor: next.to } })
          onChange()
          return true
        },
      })),
    ),
    // Alt + drag sideways: the number follows the mouse (Shift: ten at a time). Some window managers keep Alt+drag for themselves.
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (!event.altKey || event.button !== 0) return false
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
        const start = pos === null ? null : literalAt(view.state, pos)
        if (!start) return false
        event.preventDefault()
        let current = start
        const startX = event.clientX
        const move = (e: MouseEvent) => {
          const steps = Math.round((e.clientX - startX) / 6)
          const text = shifted(start.text, steps, e.shiftKey ? 10 : 1)
          if (text === null) return
          current = replace(view, current, text)
          onChange()
        }
        const up = () => {
          document.removeEventListener('mousemove', move)
          document.removeEventListener('mouseup', up)
        }
        document.addEventListener('mousemove', move)
        document.addEventListener('mouseup', up)
        return true
      },
    }),
  ]
}

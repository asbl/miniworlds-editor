import { basicSetup } from 'codemirror'
import { Decoration, EditorView, keymap, WidgetType, type DecorationSet } from '@codemirror/view'
import { Compartment, EditorSelection, EditorState, StateEffect, StateField, type Extension } from '@codemirror/state'
import { indentUnit } from '@codemirror/language'
import { codeHighlighting } from './highlight'
import { indentWithTab } from '@codemirror/commands'
import { snippet } from '@codemirror/autocomplete'
import { importChange, methodAnchor, statementAnchor, type Block } from '../blocks/insert'
import { python } from '@codemirror/lang-python'
import { diagnosticCount, openLintPanel } from '@codemirror/lint'
import type { Assist } from '../language/assist'
import { t, type Lang } from '../i18n'
import { assistExtensions, forceLinting } from './assistExtensions'
import type { ErrorNote } from '../runtime/explain'
import type { Surface } from './session'
import { numberTools } from '../live/scrub'

/** Texts of CodeMirror's search panel etc.; English is built in. */
const PHRASES: Record<Lang, Record<string, string>> = {
  en: {},
  de: {
    'Go to line': 'Gehe zu Zeile',
    go: 'los',
    Find: 'Suchen',
    Replace: 'Ersetzen',
    next: 'weiter',
    previous: 'zurück',
    all: 'alle',
    'match case': 'Groß-/Kleinschreibung',
    regexp: 'Regex',
    'by word': 'ganzes Wort',
    replace: 'ersetzen',
    'replace all': 'alle ersetzen',
    close: 'schließen',
    'current match': 'aktueller Treffer',
    'on line': 'in Zeile',
    'Folded lines': 'Eingeklappte Zeilen',
    'Unfolded lines': 'Ausgeklappte Zeilen',
    'Fold line': 'Zeile einklappen',
    'Unfold line': 'Zeile ausklappen',
  },
}

/** The error message under the failing line, with a button to dismiss it. */
class ErrorNoteWidget extends WidgetType {
  constructor(private note: ErrorNote) {
    super()
  }

  eq(other: ErrorNoteWidget): boolean {
    return other.note.title === this.note.title && other.note.tip === this.note.tip
  }

  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('div')
    box.className = 'cm-error-note'
    box.setAttribute('role', 'note')
    box.setAttribute('aria-label', t('errorNote.label'))
    const title = document.createElement('div')
    title.className = 'cm-error-title'
    title.textContent = this.note.title
    box.append(title)
    if (this.note.tip) {
      const tip = document.createElement('div')
      tip.className = 'cm-error-tip'
      tip.textContent = `💡 ${this.note.tip}`
      box.append(tip)
    }
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'cm-error-close'
    close.textContent = '×'
    close.setAttribute('aria-label', t('errorNote.close'))
    close.title = t('errorNote.close')
    close.addEventListener('click', () => view.dispatch({ effects: setErrorLine.of(null) }))
    box.append(close)
    return box
  }
}

/** Highlights the line where the program failed (with the message under it); any edit removes the mark. */
const setErrorLine = StateEffect.define<{ line: number; note: ErrorNote | null } | null>()
const errorField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    if (tr.docChanged) return Decoration.none
    for (const effect of tr.effects) {
      if (effect.is(setErrorLine)) {
        const mark = effect.value
        if (mark === null || mark.line < 1 || mark.line > tr.state.doc.lines) return Decoration.none
        const line = tr.state.doc.line(mark.line)
        const ranges = [Decoration.line({ class: 'cm-error-line' }).range(line.from)]
        if (mark.note) ranges.push(Decoration.widget({ widget: new ErrorNoteWidget(mark.note), block: true, side: 1 }).range(line.to))
        return Decoration.set(ranges)
      }
    }
    return deco
  },
  provide: (field) => EditorView.decorations.from(field),
})
/** The mark, and Escape to dismiss it (other Escape handlers - search, completion - go first). */
const errorLine: Extension = [
  errorField,
  keymap.of([
    {
      key: 'Escape',
      run: (view) => {
        if (view.state.field(errorField).size === 0) return false
        view.dispatch({ effects: setErrorLine.of(null) })
        return true
      },
    },
  ]),
]

/** A method the engine just called: its line glows for a moment (and stays lit while it keeps being called). */
const flashLine = StateEffect.define<number | null>()
const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    if (tr.docChanged) deco = Decoration.none
    for (const effect of tr.effects) {
      if (!effect.is(flashLine)) continue
      if (effect.value === null || effect.value < 1 || effect.value > tr.state.doc.lines) return Decoration.none
      return Decoration.set([Decoration.line({ class: 'cm-fired-line' }).range(tr.state.doc.line(effect.value).from)])
    }
    return deco
  },
  provide: (field) => EditorView.decorations.from(field),
})

/**
 * One CodeMirror view, one EditorState per open file (keeps undo history and
 * cursor per tab). Imperative on purpose: the UI framework only mounts it.
 */
/** Working together: the shared text of a file and what it takes to edit it together (kept free of Yjs: see `Collab.editorSource`). */
export interface CollabSource {
  text(path: string): string | undefined
  extensions(path: string): Extension[] | null
}

export class EditorHost implements Surface {
  readonly view: EditorView
  private states = new Map<string, EditorState>()
  private collab: CollabSource | null = null
  /** Somebody who only watches, or whose turn it is not (pair programming): the text cannot be changed. */
  private lock = new Compartment()
  private locked = false
  private current: string | null = null
  private language = new Compartment()
  private assist: Assist | null = null
  private assistExt = assistExtensions(
    () => this.assist,
    () => this.current,
  )
  /** Number of problems in the file shown (hints and lint). */
  onProblems: (count: number) => void = () => {}
  /** A number was changed with the slider, the keys or the colour picker: apply it to the running world. */
  onNumberChange: () => void = () => {}
  private numbers = numberTools(() => this.onNumberChange())
  private lastCount = -1

  constructor(
    parent: HTMLElement,
    private onChange: (path: string, text: string) => void,
    private lang: Lang,
    /** Cursor moved or text changed: file and 1-based line of the main selection. */
    private onCursor: (path: string, line: number) => void = () => {},
  ) {
    this.view = new EditorView({ parent, state: EditorState.create({ doc: '', extensions: [this.language.of(this.phrases())] }) })
    // a long line makes the scroll area scroll sideways; keyboard users need a way in (WCAG 2.1.1, axe: scrollable-region-focusable)
    this.view.scrollDOM.tabIndex = 0
    this.view.scrollDOM.setAttribute('role', 'region')
    this.view.scrollDOM.setAttribute('aria-label', t('a11y.editorScroll', undefined, this.lang))
  }

  private phrases() {
    return EditorState.phrases.of(PHRASES[this.lang])
  }

  private lockExtension(): Extension {
    return [EditorState.readOnly.of(this.locked), EditorView.editable.of(!this.locked)]
  }

  /** Allow or forbid typing (a watcher, or somebody who is not driving). Takes effect in the file shown and in every file shown later. */
  setLocked(locked: boolean): void {
    if (locked === this.locked) return
    this.locked = locked
    this.view.dispatch({ effects: this.lock.reconfigure(this.lockExtension()) })
  }

  /** Connect the editor to a shared project (or, with null, back to plain files). Call before the first file is shown. */
  setCollab(source: CollabSource | null): void {
    this.collab = source
    this.states.clear()
  }

  private createState(path: string, text: string): EditorState {
    const shared = this.collab?.extensions(path) ?? null
    return EditorState.create({
      doc: shared ? (this.collab?.text(path) ?? text) : text,
      extensions: [
        basicSetup,
        // the shared text is the truth; its own undo only takes back one's own typing, so it comes before the ordinary history keys
        ...(shared ?? []),
        this.lock.of(this.lockExtension()),
        python(),
        codeHighlighting,
        errorLine,
        flashField,
        this.numbers,
        this.assistExt,
        this.language.of(this.phrases()),
        // the editing area is a text box for assistive technology: it needs a name (and the file it shows)
        EditorView.contentAttributes.of(() => ({ 'aria-label': t('a11y.editor', { path }, this.lang) })),
        indentUnit.of('    '),
        EditorState.tabSize.of(4),
        keymap.of([indentWithTab, { key: 'Shift-Alt-f', run: () => (void this.format(), true) }]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && this.current === path) {
            this.assist?.wake()
            this.onChange(path, update.state.doc.toString())
          }
          const count = diagnosticCount(update.state)
          if (this.current === path && count !== this.lastCount) {
            this.lastCount = count
            this.onProblems(count)
          }
          if ((update.selectionSet || update.docChanged) && this.current === path) {
            this.onCursor(path, update.state.doc.lineAt(update.state.selection.main.head).number)
          }
        }),
      ],
    })
  }

  show(path: string, text: string): void {
    if (this.current) this.states.set(this.current, this.view.state)
    this.current = path
    // a shared file is always built anew from the shared text: a kept state would miss what the others typed meanwhile
    this.view.setState((!this.collab && this.states.get(path)) || this.createState(path, text))
    this.onCursor(path, this.view.state.doc.lineAt(this.view.state.selection.main.head).number)
    this.lastCount = diagnosticCount(this.view.state)
    this.onProblems(this.lastCount)
    this.view.focus()
  }

  clear(): void {
    if (this.current) this.states.set(this.current, this.view.state)
    this.current = null
    this.view.setState(EditorState.create({ doc: '', extensions: [this.language.of(this.phrases())] }))
    this.lastCount = 0
    this.onProblems(0)
  }

  forget(path: string): void {
    this.states.delete(path)
    if (this.current === path) this.current = null
  }

  /** Select a search hit (1-based line, 0-based column) and scroll it into view. */
  reveal(line: number, column: number, length: number): void {
    const doc = this.view.state.doc
    const row = doc.line(Math.min(Math.max(line, 1), doc.lines))
    const from = Math.min(row.from + column, row.to)
    const to = Math.min(from + length, row.to)
    this.view.dispatch({ selection: EditorSelection.single(from, to), effects: EditorView.scrollIntoView(from, { y: 'center' }) })
    this.view.focus()
  }

  /** Connect the language service; existing and new editors use it from now on. */
  setAssist(assist: Assist | null): void {
    this.assist = assist
    this.relint()
  }

  /** Ask for fresh hints now (the engine API or the service became available). */
  relint(): void {
    if (this.current) forceLinting(this.view)
  }

  openProblems(): void {
    openLintPanel(this.view)
  }

  /** Format the file shown with ruff; false when nothing was done. */
  async format(): Promise<boolean> {
    if (!this.current?.endsWith('.py')) return false
    const before = this.view.state.doc.toString()
    const after = await this.assist?.format(before)
    if (after == null || after === before || this.view.state.doc.toString() !== before) return false
    const head = Math.min(this.view.state.selection.main.head, after.length)
    this.view.dispatch({ changes: { from: 0, to: before.length, insert: after }, selection: { anchor: head } })
    return true
  }

  /**
   * Put a ready-made block at the cursor (statements) or at the end of the class (methods), add the imports it needs,
   * and let Tab walk through its fields. False when a method block has no class to go into.
   */
  insertBlock(block: Block): boolean {
    const doc = this.view.state.doc.toString()
    const head = this.view.state.selection.main.head
    const anchor = block.kind === 'method' ? methodAnchor(doc, head) : statementAnchor(doc, head)
    if (!anchor) return false
    const imports = importChange(doc, block.imports)
    const changes: { from: number; to?: number; insert: string }[] = [{ from: anchor.from, to: anchor.to, insert: anchor.insert }]
    let start = anchor.from + anchor.insert.length
    if (imports) {
      changes.push(imports)
      if (imports.from <= anchor.from) start += imports.insert.length
    }
    this.view.dispatch({ changes, selection: { anchor: start }, scrollIntoView: true })
    snippet(block.code)(this.view, null, start, start)
    this.view.focus()
    return true
  }

  /** Insert text at the cursor (or replace the selection) of the file shown. */
  insertText(text: string): void {
    this.view.dispatch(this.view.state.replaceSelection(text))
    this.view.focus()
  }

  /** Mark (or with null clear) the failing line of the file currently shown, with the message under it when given. */
  markError(line: number | null, note: ErrorNote | null = null): void {
    this.view.dispatch({ effects: setErrorLine.of(line === null ? null : { line, note }) })
  }

  private flashTimer: ReturnType<typeof setTimeout> | null = null

  /** Let the line of a method glow (only when its file is the one shown); it fades about half a second after the last call. */
  flash(path: string, line: number): void {
    if (this.current !== path) return
    this.view.dispatch({ effects: flashLine.of(line) })
    if (this.flashTimer) clearTimeout(this.flashTimer)
    this.flashTimer = setTimeout(() => {
      this.flashTimer = null
      this.view.dispatch({ effects: flashLine.of(null) })
    }, 500)
  }

  /** Remove the error mark in every open file (called when the program starts again). */
  clearErrors(): void {
    for (const [path, state] of this.states) this.states.set(path, state.update({ effects: setErrorLine.of(null) }).state)
    this.view.dispatch({ effects: setErrorLine.of(null) })
  }

  setLang(lang: Lang): void {
    this.lang = lang
    const effects = this.language.reconfigure(this.phrases())
    for (const [path, state] of this.states) this.states.set(path, state.update({ effects }).state)
    this.view.dispatch({ effects })
  }

  destroy(): void {
    this.view.destroy()
  }
}

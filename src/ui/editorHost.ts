import { basicSetup } from 'codemirror'
import { Decoration, EditorView, keymap } from '@codemirror/view'
import { Compartment, EditorSelection, EditorState, StateEffect, StateField, type Extension } from '@codemirror/state'
import { indentUnit } from '@codemirror/language'
import { codeHighlighting } from './highlight'
import { indentWithTab } from '@codemirror/commands'
import { python } from '@codemirror/lang-python'
import { diagnosticCount, openLintPanel } from '@codemirror/lint'
import type { Assist } from '../language/assist'
import { t, type Lang } from '../i18n'
import { assistExtensions, forceLinting } from './assistExtensions'
import type { Surface } from './session'

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

/** Highlights the line where the program failed; any edit removes the mark. */
const setErrorLine = StateEffect.define<number | null>()
const errorLine: Extension = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    if (tr.docChanged) return Decoration.none
    for (const effect of tr.effects) {
      if (effect.is(setErrorLine)) {
        if (effect.value === null || effect.value < 1 || effect.value > tr.state.doc.lines) return Decoration.none
        return Decoration.set([Decoration.line({ class: 'cm-error-line' }).range(tr.state.doc.line(effect.value).from)])
      }
    }
    return deco
  },
  provide: (field) => EditorView.decorations.from(field),
})

/**
 * One CodeMirror view, one EditorState per open file (keeps undo history and
 * cursor per tab). Imperative on purpose: the UI framework only mounts it.
 */
export class EditorHost implements Surface {
  readonly view: EditorView
  private states = new Map<string, EditorState>()
  private current: string | null = null
  private language = new Compartment()
  private assist: Assist | null = null
  private assistExt = assistExtensions(
    () => this.assist,
    () => this.current,
  )
  /** Number of problems in the file shown (hints and lint). */
  onProblems: (count: number) => void = () => {}
  private lastCount = -1

  constructor(
    parent: HTMLElement,
    private onChange: (path: string, text: string) => void,
    private lang: Lang,
    /** Cursor moved or text changed: file and 1-based line of the main selection. */
    private onCursor: (path: string, line: number) => void = () => {},
  ) {
    this.view = new EditorView({ parent, state: EditorState.create({ doc: '', extensions: [this.language.of(this.phrases())] }) })
  }

  private phrases() {
    return EditorState.phrases.of(PHRASES[this.lang])
  }

  private createState(path: string, text: string): EditorState {
    return EditorState.create({
      doc: text,
      extensions: [
        basicSetup,
        python(),
        codeHighlighting,
        errorLine,
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
    this.view.setState(this.states.get(path) ?? this.createState(path, text))
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

  /** Insert text at the cursor (or replace the selection) of the file shown. */
  insertText(text: string): void {
    this.view.dispatch(this.view.state.replaceSelection(text))
    this.view.focus()
  }

  /** Mark (or with null clear) the failing line of the file currently shown. */
  markError(line: number | null): void {
    this.view.dispatch({ effects: setErrorLine.of(line) })
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

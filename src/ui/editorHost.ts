import { basicSetup } from 'codemirror'
import { Decoration, EditorView, keymap } from '@codemirror/view'
import { Compartment, EditorSelection, EditorState, StateEffect, StateField, type Extension } from '@codemirror/state'
import { indentUnit } from '@codemirror/language'
import { indentWithTab } from '@codemirror/commands'
import { python } from '@codemirror/lang-python'
import type { Lang } from '../i18n'
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

  constructor(
    parent: HTMLElement,
    private onChange: (path: string, text: string) => void,
    private lang: Lang,
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
        errorLine,
        this.language.of(this.phrases()),
        indentUnit.of('    '),
        EditorState.tabSize.of(4),
        keymap.of([indentWithTab]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && this.current === path) {
            this.onChange(path, update.state.doc.toString())
          }
        }),
      ],
    })
  }

  show(path: string, text: string): void {
    if (this.current) this.states.set(this.current, this.view.state)
    this.current = path
    this.view.setState(this.states.get(path) ?? this.createState(path, text))
    this.view.focus()
  }

  clear(): void {
    if (this.current) this.states.set(this.current, this.view.state)
    this.current = null
    this.view.setState(EditorState.create({ doc: '', extensions: [this.language.of(this.phrases())] }))
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

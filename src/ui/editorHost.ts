import { basicSetup } from 'codemirror'
import { EditorView, keymap } from '@codemirror/view'
import { Compartment, EditorSelection, EditorState } from '@codemirror/state'
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

import { basicSetup } from 'codemirror'
import { EditorView, keymap } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { indentUnit } from '@codemirror/language'
import { indentWithTab } from '@codemirror/commands'
import { python } from '@codemirror/lang-python'

/**
 * One CodeMirror view, one EditorState per open file (keeps undo history and
 * cursor per tab). Imperative on purpose: the UI framework only mounts it.
 */
export class EditorHost {
  readonly view: EditorView
  private states = new Map<string, EditorState>()
  private current: string | null = null

  constructor(
    parent: HTMLElement,
    private onChange: (path: string, text: string) => void,
  ) {
    this.view = new EditorView({ parent, state: EditorState.create({ doc: '' }) })
  }

  private createState(path: string, text: string): EditorState {
    return EditorState.create({
      doc: text,
      extensions: [
        basicSetup,
        python(),
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
    this.view.setState(EditorState.create({ doc: '' }))
  }

  forget(path: string): void {
    this.states.delete(path)
    if (this.current === path) this.current = null
  }

  destroy(): void {
    this.view.destroy()
  }
}

/** Messages between the main thread and the language worker (jedi, miniworlds hints, ruff). */

export interface JediItem {
  name: string
  type: string
  doc: string
}
/** The call being typed: `move(distance=1)`, `index` is the parameter under the cursor (null: none). */
export interface Signature {
  name: string
  params: string[]
  index: number | null
  /** First docstring line, shown under the signature when there is one. */
  doc?: string
}
export interface Hover {
  name: string
  type: string
  doc: string
}
/** From miniworlds.tools.code_hints. Lines are 1-based, columns 0-based UTF-16. */
export interface EngineHint {
  file: string
  line: number
  col: number
  end_col: number
  severity: 'error' | 'warning' | 'info'
  code: string
  message: string
  replacement: string | null
}
/** From ruff-wasm (`Workspace.check`): rows and columns are 1-based. */
export interface RuffDiagnostic {
  code: string | null
  message: string
  start_location: { row: number; column: number }
  end_location: { row: number; column: number }
  fix: { message: string | null; edits: { content: string | null; location: { row: number; column: number }; end_location: { row: number; column: number } }[] } | null
}

export type ToLanguage =
  | { type: 'boot'; pyodideBase: string; miniworlds: string | null }
  | { type: 'api'; index: string }
  | { type: 'sync'; files: Record<string, string> }
  | { type: 'req'; id: number; name: 'complete' | 'hover' | 'signature' | 'hints' | 'lint' | 'format'; args: unknown[] }

export type FromLanguage =
  /** `hints`: this engine version has code_hints; `ruff`: lint and format are available. */
  | { type: 'ready'; hints: boolean; ruff: boolean; python: boolean; version: string | null }
  | { type: 'boot-error'; text: string }
  | { type: 'res'; id: number; ok: true; value: unknown }
  | { type: 'res'; id: number; ok: false; error: string }

import type { ModelClass } from '../uml/model'

export type Dock = 'right' | 'left' | 'bottom'
export type WidgetSpec = { kind: 'button'; text: string } | { kind: 'label'; text: string } | { kind: 'counter'; text: string; name: string }

export interface ToolbarSpec {
  dock: Dock
  widgets: WidgetSpec[]
}

export const START = '# Bedienfeld '
export const END = '# Ende Bedienfeld'
const START_LINE = /^(\s*)# Bedienfeld (\{.*\})\s*$/

type ClassSpan = Pick<ModelClass, 'line' | 'end_line' | 'methods'>

const isDock = (v: unknown): v is Dock => v === 'right' || v === 'left' || v === 'bottom'
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

/** A counter needs a name to be found again (`self.punkte.add(1)`). */
export const validName = (name: string) => IDENT.test(name)

function valid(raw: unknown): ToolbarSpec | null {
  const spec = raw as Partial<ToolbarSpec> | null
  if (!spec || !isDock(spec.dock) || !Array.isArray(spec.widgets)) return null
  const widgets: WidgetSpec[] = []
  for (const w of spec.widgets as Record<string, unknown>[]) {
    if (typeof w?.text !== 'string') return null
    if (w.kind === 'button' || w.kind === 'label') widgets.push({ kind: w.kind, text: w.text })
    else if (w.kind === 'counter' && typeof w.name === 'string') widgets.push({ kind: 'counter', text: w.text, name: w.name })
    else return null
  }
  return { dock: spec.dock, widgets }
}

/** The control panel an earlier "Build a control panel" wrote into the class (its marker line carries the data). */
export function readToolbar(classSource: string): ToolbarSpec | null {
  for (const line of classSource.split('\n')) {
    const m = START_LINE.exec(line)
    if (!m) continue
    try {
      return valid(JSON.parse(m[2] as string))
    } catch {
      return null
    }
  }
  return null
}

/** How the file spells the engine: `mw.` for `import miniworlds as mw`, nothing for `from miniworlds import *`, null when it does not import it. */
export function enginePrefix(source: string): string | null {
  const alias = /^\s*import\s+miniworlds\s+as\s+(\w+)/m.exec(source)
  if (alias) return `${alias[1]}.`
  if (/^\s*from\s+miniworlds\s+import\s+\*/m.test(source)) return ''
  if (/^\s*import\s+miniworlds\s*$/m.test(source)) return 'miniworlds.'
  return null
}

const str = (text: string) => JSON.stringify(text)

/** The Python lines of the panel, without indentation. */
export function toolbarLines(spec: ToolbarSpec, prefix: string): string[] {
  const lines = [`${START}${JSON.stringify(spec)}`, `toolbar = ${prefix}Toolbar()`]
  for (const w of spec.widgets) {
    if (w.kind === 'button') lines.push(`toolbar.add(${prefix}Button(${str(w.text)}))`)
    else if (w.kind === 'label') lines.push(`toolbar.add(${prefix}Label(${str(w.text)}))`)
    else lines.push(`self.${w.name} = ${prefix}CounterLabel(${str(w.text)}, 0)`, `toolbar.add(self.${w.name})`)
  }
  lines.push(`self.camera.add_${spec.dock}(toolbar)`, END)
  return lines
}

/** `on_message` for the buttons: one branch per button text. */
export function messageHandlerLines(spec: ToolbarSpec): string[] {
  const buttons = spec.widgets.filter((w) => w.kind === 'button')
  if (buttons.length === 0) return []
  return ['def on_message(self, message):', ...buttons.flatMap((b) => [`    if message == ${str(b.text)}:`, '        pass'])]
}

export type ToolbarEdit = { ok: true; text: string; handlerAdded: boolean } | { ok: false; reason: 'one-line-setup' }

const leading = (line: string) => /^[ \t]*/.exec(line)![0]

/** Last line (0-based) that belongs to the method starting at line `from`. */
function methodEnd(lines: string[], from: number, limit: number): number {
  const base = leading(lines[from] as string).length
  let last = from
  for (let i = from + 1; i < limit; i++) {
    const l = lines[i] as string
    if (l.trim() === '') continue
    if (leading(l).length <= base) break
    last = i
  }
  return last
}

/**
 * Writes the panel into the class's `on_setup` (created when missing). An earlier panel (between its marker lines) is
 * replaced. With `handler`, `on_message` is added for the buttons unless the class has one.
 */
export function setToolbar(source: string, cls: ClassSpan, spec: ToolbarSpec, handler: boolean): ToolbarEdit {
  let text = source
  let shift = 0
  let prefix = enginePrefix(text)
  if (prefix === null) {
    text = `import miniworlds as mw\n${text}`
    shift = 1
    prefix = 'mw.'
  }
  const lines = text.split('\n')
  const start = cls.line - 1 + shift
  let end = Math.min(cls.end_line + shift, lines.length) // exclusive
  const block = (indent: string) => toolbarLines(spec, prefix as string).map((l) => indent + l)

  const from = lines.findIndex((l, i) => i >= start && i < end && START_LINE.test(l))
  if (from !== -1) {
    const to = lines.findIndex((l, i) => i > from && i < end && l.trim() === END)
    if (to !== -1) {
      lines.splice(from, to - from + 1, ...block(leading(lines[from] as string)))
      end += block('').length - (to - from + 1)
      return finish(lines, cls, shift, end, spec, handler)
    }
  }

  const setup = cls.methods.find((m) => m.name === 'on_setup')
  if (setup) {
    const defIndex = setup.line - 1 + shift
    const defLine = lines[defIndex] as string
    const afterSignature = defLine.replace(/^\s*def\s+\w+\([^)]*\)\s*(->\s*[^:]+)?/, '')
    if (/:\s*[^\s#]/.test(afterSignature)) return { ok: false, reason: 'one-line-setup' }
    const last = methodEnd(lines, defIndex, end)
    const add = block(leading(defLine) + '    ')
    lines.splice(last + 1, 0, ...add)
    end += add.length
  } else {
    let at = end
    while (at > start + 1 && (lines[at - 1] as string).trim() === '') at--
    const add = ['', '    def on_setup(self):', ...block('        ')]
    lines.splice(at, 0, ...add)
    end += add.length
  }
  return finish(lines, cls, shift, end, spec, handler)
}

function finish(lines: string[], cls: ClassSpan, shift: number, end: number, spec: ToolbarSpec, handler: boolean): ToolbarEdit {
  let handlerAdded = false
  const wanted = handler ? messageHandlerLines(spec) : []
  if (wanted.length > 0 && !cls.methods.some((m) => m.name === 'on_message')) {
    let at = end
    while (at > cls.line - 1 + shift + 1 && (lines[at - 1] as string).trim() === '') at--
    lines.splice(at, 0, '', ...wanted.map((l) => '    ' + l))
    handlerAdded = true
  }
  return { ok: true, text: lines.join('\n'), handlerAdded }
}

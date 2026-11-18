import { parser } from '@lezer/python'
import { CLASS_DIR, classPath } from './classes'

export interface RenameResult {
  /** New text of every file that changed (under its current path). */
  texts: Record<string, string>
  /** The class's own file follows the name: `classes/Old.py` -> `classes/New.py`. */
  move: { from: string; to: string } | null
  /** Number of places that were renamed. */
  count: number
}

interface Edit {
  from: number
  to: number
}

interface Piece extends Edit {
  name: string
}

/** Edits in one source text: the class definition, its uses, and `from classes.Old import Old`. Strings and comments stay. */
function editsFor(source: string, oldName: string): Edit[] {
  const edits: Edit[] = []
  const imports: Edit[] = []
  let foreign = false // the name also comes from another module in this file: not our class here
  const text = (e: Edit) => source.slice(e.from, e.to)

  function inImport(statement: { firstChild: { name: string; from: number; to: number; nextSibling: unknown } | null }) {
    const kids: Piece[] = []
    for (let c = statement.firstChild as { name: string; from: number; to: number; nextSibling: typeof c } | null; c; c = c.nextSibling) kids.push({ name: c.name, from: c.from, to: c.to })
    const names = kids.filter((k) => k.name === 'VariableName')
    if (kids[0]?.name === 'from') {
      // from classes.Old import Old [as X], Other
      const at = kids.findIndex((k) => k.name === 'import')
      const path = kids.slice(1, at === -1 ? undefined : at).filter((k) => k.name === 'VariableName')
      if (path.length !== 2 || text(path[0] as Edit) !== CLASS_DIR || text(path[1] as Edit) !== oldName) {
        if (at !== -1 && kids.slice(at + 1).some((k, i) => k.name === 'VariableName' && text(k) === oldName && kids[at + i]?.name !== 'as')) foreign = true
        return
      }
      edits.push(path[1] as Edit)
      for (let i = at + 1; at !== -1 && i < kids.length; i++) {
        const k = kids[i] as Piece
        if (k.name === 'VariableName' && text(k) === oldName && kids[i - 1]?.name !== 'as') edits.push(k)
      }
    } else if (names.length >= 2 && text(names[0] as Edit) === CLASS_DIR && text(names[1] as Edit) === oldName) {
      // import classes.Old [as X]
      edits.push(names[1] as Edit)
    }
  }

  const cursor = parser.parse(source).cursor()
  do {
    if (cursor.name === 'ImportStatement') {
      imports.push({ from: cursor.from, to: cursor.to })
      inImport(cursor.node)
    } else if (cursor.name === 'VariableName' && source.slice(cursor.from, cursor.to) === oldName) {
      // names inside import statements were decided above (only imports of our own module count)
      if (!imports.some((r) => cursor.from >= r.from && cursor.to <= r.to)) edits.push({ from: cursor.from, to: cursor.to })
    }
  } while (cursor.next())
  return foreign ? [] : edits
}

function apply(source: string, edits: Edit[], replacement: string): string {
  let out = ''
  let at = 0
  for (const e of [...edits].sort((a, b) => a.from - b.from)) {
    out += source.slice(at, e.from) + replacement
    at = e.to
  }
  return out + source.slice(at)
}

/**
 * Renames a class across the project: its definition, every use and import, and its file (`classes/Old.py`).
 * `texts` maps the paths of the project's Python files to their content.
 */
export function renameClass(texts: Record<string, string>, oldName: string, newName: string): RenameResult {
  const changed: Record<string, string> = {}
  let count = 0
  for (const [path, source] of Object.entries(texts)) {
    if (!path.endsWith('.py')) continue
    const edits = editsFor(source, oldName)
    if (edits.length === 0) continue
    count += edits.length
    changed[path] = apply(source, edits, newName)
  }
  const from = classPath(oldName)
  const move = from in texts ? { from, to: classPath(newName) } : null
  return { texts: changed, move, count }
}

/** Python's own names; a class called like one of them would hide it for the whole file. */
const BUILTINS = new Set(
  ('abs all any bin bool bytes callable chr dict dir divmod enumerate filter float format frozenset getattr hasattr hash hex id input int ' +
    'isinstance issubclass iter len list map max min next object oct open ord pow print range repr reversed round set setattr slice sorted ' +
    'str sum super tuple type vars zip Exception ValueError TypeError KeyError IndexError NameError AttributeError RuntimeError').split(' '),
)

/** Where a new class name would run into a name that is already in use. */
export type NameClash = { kind: 'builtin' } | { kind: 'used'; path: string; line: number }

/**
 * The name a class is about to get may already stand for something else: a variable, a function, a parameter or an import in some
 * file, or one of Python's built-in names. Then renaming would silently mix two things up, so the dialog refuses it.
 * Attributes (`self.Name`), strings and comments do not count. `texts` maps the paths of the project's Python files to their content.
 */
export function findNameClash(texts: Record<string, string>, newName: string): NameClash | null {
  if (BUILTINS.has(newName)) return { kind: 'builtin' }
  for (const [path, source] of Object.entries(texts)) {
    if (!path.endsWith('.py') || !source.includes(newName)) continue // cheap filter before parsing
    const cursor = parser.parse(source).cursor()
    do {
      if (cursor.name === 'VariableName' && source.slice(cursor.from, cursor.to) === newName) {
        return { kind: 'used', path, line: source.slice(0, cursor.from).split('\n').length }
      }
    } while (cursor.next())
  }
  return null
}

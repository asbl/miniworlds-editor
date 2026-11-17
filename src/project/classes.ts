export type ClassKind = 'actor' | 'world' | 'plain'

export const CLASS_DIR = 'classes'

const PYTHON_KEYWORDS = new Set(
  ('False None True and as assert async await break class continue def del elif else except finally for from global ' +
    'if import in is lambda nonlocal not or pass raise return try while with yield match case type').split(' '),
)

export type NameProblem = 'invalid' | 'reserved'

/** null = fine. Names become both the class name and the file name, so keep them plain identifiers. */
export function classNameProblem(name: string): NameProblem | null {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return 'invalid'
  if (PYTHON_KEYWORDS.has(name)) return 'reserved'
  return null
}

export const classPath = (name: string) => `${CLASS_DIR}/${name}.py`
export const importLine = (name: string) => `from ${CLASS_DIR}.${name} import ${name}`

export function classSource(kind: ClassKind, name: string): string {
  switch (kind) {
    case 'world':
      return `import miniworlds as mw


class ${name}(mw.World):
    def on_setup(self):
        self.add_background((226, 238, 214))
`
    case 'actor':
      return `import miniworlds as mw


class ${name}(mw.Circle):
    def __init__(self, position=(0, 0)):
        super().__init__(position, 15)
        self.fill_color = (60, 110, 200)

    def act(self):
        self.move(1)
`
    case 'plain':
      return `class ${name}:
    pass
`
  }
}

/** Index just past the last top-level import statement in the leading import block, or -1 if none. */
function lastImportEnd(lines: string[]): number {
  let last = -1
  let i = 0
  // optional module docstring
  while (i < lines.length && /^\s*(#.*)?$/.test(lines[i] as string)) i++
  const doc = /^(?:[rRuUbB]*)("""|''')/.exec(lines[i] ?? '')
  if (doc) {
    const quote = doc[1] as string
    const rest = (lines[i] as string).slice(doc[0].length)
    if (!rest.includes(quote)) {
      i++
      while (i < lines.length && !(lines[i] as string).includes(quote)) i++
    }
    i++
  } else if (/^(?:[rRuUbB]*)("|')/.test(lines[i] ?? '')) i++
  for (; i < lines.length; i++) {
    const line = lines[i] as string
    if (/^(import|from)\s/.test(line)) {
      let end = i
      if (line.includes('(') && !line.includes(')')) {
        while (end + 1 < lines.length && !(lines[end] as string).includes(')')) end++
      } else {
        while (end + 1 < lines.length && (lines[end] as string).trimEnd().endsWith('\\')) end++
      }
      last = end
      i = end
    } else if (!/^\s*(#.*)?$/.test(line)) break
  }
  return last
}

/** Adds `from classes.X import X` after the existing imports. Idempotent. */
export function addImport(source: string, name: string): string {
  const line = importLine(name)
  if (source.split(/\r?\n/).some((l) => l.trim() === line)) return source
  const lines = source.split('\n')
  const end = lastImportEnd(lines)
  if (end >= 0) {
    lines.splice(end + 1, 0, line)
  } else {
    // no imports yet: put it at the top (after a leading shebang/docstring-free file this is line 0)
    lines.unshift(line, ...(source.trim() === '' ? [] : ['']))
  }
  return lines.join('\n')
}

/** Removes the import line again (used when a class file is deleted or renamed). */
export function removeImport(source: string, name: string): string {
  const line = importLine(name)
  return source
    .split('\n')
    .filter((l) => l.trim() !== line)
    .join('\n')
}

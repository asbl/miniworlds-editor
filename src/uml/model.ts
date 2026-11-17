/** Shapes produced by miniworlds' `tools.class_model.analyze` (static, from the source text; nothing is run). */
export interface Member {
  name: string
  line: number
  visibility: '+' | '-'
  /** Methods only. */
  params?: string[]
  kind?: 'event' | 'method'
  /** Attributes only: defined in the class body, not via self. */
  static?: boolean
}
export type ClassKind = 'actor' | 'world' | 'other'
export interface ModelClass {
  name: string
  file: string
  line: number
  end_line: number
  bases: string[]
  methods: Member[]
  attributes: Member[]
  kind: ClassKind
}
export interface ModelLibrary {
  name: string
  base: string | null
  kind: ClassKind
}
export interface ModelError {
  file: string
  line: number
  message: string
}
export interface ClassModel {
  classes: ModelClass[]
  libraries: ModelLibrary[]
  errors: ModelError[]
}

export const emptyModel = (): ClassModel => ({ classes: [], libraries: [], errors: [] })

/** A file with a syntax error keeps the classes it had last time, so the diagram does not flicker while typing. */
export function mergeWithPrevious(previous: ClassModel | null, next: ClassModel): ClassModel {
  if (!previous || next.errors.length === 0) return next
  const broken = new Set(next.errors.map((e) => e.file))
  const classes = [...next.classes, ...previous.classes.filter((c) => broken.has(c.file))]
  const known = new Set(next.libraries.map((l) => l.name))
  const libraries = [...next.libraries, ...previous.libraries.filter((l) => !known.has(l.name))]
  return { classes, libraries, errors: next.errors }
}

/** Source text of a class (for detecting "changed since the last start"). */
export function classSource(c: ModelClass, files: Record<string, string>): string {
  const text = files[c.file]
  return typeof text === 'string' ? text.split('\n').slice(c.line - 1, c.end_line).join('\n') : ''
}

/** Signature per class at world start. */
export function signatures(model: ClassModel, files: Record<string, string>): Record<string, string> {
  return Object.fromEntries(model.classes.map((c) => [c.name, classSource(c, files)]))
}

/** Classes whose code differs from the loaded program ("not compiled" in Greenfoot). */
export function staleClasses(model: ClassModel, files: Record<string, string>, loaded: Record<string, string> | null): Set<string> {
  const stale = new Set<string>()
  if (!loaded) return stale
  for (const c of model.classes) if (loaded[c.name] !== classSource(c, files)) stale.add(c.name)
  return stale
}

/** Which class contains this line of this file? */
export function classAtLine(model: ClassModel, file: string, line: number): string | null {
  let hit: string | null = null
  for (const c of model.classes) if (c.file === file && line >= c.line && line <= c.end_line) hit = c.name
  return hit
}

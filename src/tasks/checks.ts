import type { ClassModel } from '../uml/model'
import { classSource } from '../uml/model'
import { classImagePath } from '../project/classImage'

/**
 * What a task can check about the pupil's work. Everything is plain data, so a template (or a teacher's project file) can
 * carry it in miniworlds.json. "Ever" means: at any time since the world was started.
 */
export type Check =
  | { type: 'actors'; cls: string; min?: number } // at least `min` (default 1) actors of the class were in the world
  | { type: 'gone'; cls: string } // there were some, and now there are none
  | { type: 'fewer'; cls: string } // fewer than the most there were
  | { type: 'moved'; cls: string } // an actor of the class has moved since the world started
  | { type: 'selected'; cls?: string } // the pupil selected an actor (of the class)
  | { type: 'called'; method?: string } // a method was called from the world's menu
  | { type: 'frames'; min: number } // the world has run at least this many steps
  | { type: 'output'; contains: string } // the console printed this text
  | { type: 'class'; name: string } // the project has a class of this name
  | { type: 'method'; cls: string; name: string } // …with a method of this name
  | { type: 'image'; cls: string } // …whose source sets a picture
  | { type: 'changed'; path: string; hash: string } // the file differs from the template's version (hash of that)
  | { type: 'handler'; prefix: string; tip?: string } // some class has a method whose name starts with this (on_key_pressed, on_detecting, ...)
  | { type: 'source'; contains: string; tip?: string } // some Python file contains this text
  | { type: 'all'; of: Check[] }

/** What the world did since it was started (see `FactTracker`). */
export interface Facts {
  maxByClass: Record<string, number>
  byClass: Record<string, number>
  moved: string[]
  selected: string[]
  called: string[]
  maxFrame: number
}
export const EMPTY_FACTS: Facts = { maxByClass: {}, byClass: {}, moved: [], selected: [], called: [], maxFrame: 0 }

export interface CheckEnv {
  facts: Facts
  /** Everything the program printed so far. */
  output: string
  model: ClassModel | null
  /** Python sources as the pupil sees them now. */
  files: Record<string, string>
}

/** Short stable hash of a text (not for security: it only notices that a file changed). */
export function hashText(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0
  return h.toString(36)
}

export function evaluate(check: Check, env: CheckEnv): boolean {
  const { facts } = env
  switch (check.type) {
    case 'actors':
      return (facts.maxByClass[check.cls] ?? 0) >= (check.min ?? 1)
    case 'gone':
      return (facts.maxByClass[check.cls] ?? 0) > 0 && (facts.byClass[check.cls] ?? 0) === 0
    case 'fewer':
      return (facts.byClass[check.cls] ?? 0) < (facts.maxByClass[check.cls] ?? 0)
    case 'moved':
      return facts.moved.includes(check.cls)
    case 'selected':
      return check.cls ? facts.selected.includes(check.cls) : facts.selected.length > 0
    case 'called':
      return check.method ? facts.called.includes(check.method) : facts.called.length > 0
    case 'frames':
      return facts.maxFrame >= check.min
    case 'output':
      return env.output.includes(check.contains)
    case 'class':
      return env.model?.classes.some((c) => c.name === check.name) ?? false
    case 'method':
      return env.model?.classes.find((c) => c.name === check.cls)?.methods.some((m) => m.name === check.name) ?? false
    case 'image': {
      const cls = env.model?.classes.find((c) => c.name === check.cls)
      return cls ? classImagePath(classSource(cls, env.files)) !== null : false
    }
    case 'changed': {
      const text = env.files[check.path]
      return typeof text === 'string' && hashText(text) !== check.hash
    }
    case 'handler':
      return env.model?.classes.some((c) => c.methods.some((m) => m.name.startsWith(check.prefix))) ?? false
    case 'source':
      return Object.entries(env.files).some(([path, text]) => path.endsWith('.py') && text.includes(check.contains))
    case 'all':
      return check.of.length > 0 && check.of.every((c) => evaluate(c, env))
  }
}

const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0

/** Tolerant reading (a hand-edited project file): anything that is not a known, complete check becomes null. */
export function parseCheck(raw: unknown, depth = 0): Check | null {
  if (typeof raw !== 'object' || raw === null || depth > 3) return null
  const r = raw as Record<string, unknown>
  switch (r.type) {
    case 'actors':
      return str(r.cls) ? { type: 'actors', cls: r.cls, ...(typeof r.min === 'number' ? { min: r.min } : {}) } : null
    case 'gone':
    case 'fewer':
    case 'moved':
    case 'image':
      return str(r.cls) ? { type: r.type, cls: r.cls } : null
    case 'selected':
      return str(r.cls) ? { type: 'selected', cls: r.cls } : { type: 'selected' }
    case 'called':
      return str(r.method) ? { type: 'called', method: r.method } : { type: 'called' }
    case 'frames':
      return typeof r.min === 'number' ? { type: 'frames', min: r.min } : null
    case 'output':
      return str(r.contains) ? { type: 'output', contains: r.contains } : null
    case 'class':
      return str(r.name) ? { type: 'class', name: r.name } : null
    case 'method':
      return str(r.cls) && str(r.name) ? { type: 'method', cls: r.cls, name: r.name } : null
    case 'changed':
      return str(r.path) && str(r.hash) ? { type: 'changed', path: r.path, hash: r.hash } : null
    case 'handler':
      return str(r.prefix) ? { type: 'handler', prefix: r.prefix, ...(str(r.tip) ? { tip: r.tip } : {}) } : null
    case 'source':
      return str(r.contains) ? { type: 'source', contains: r.contains, ...(str(r.tip) ? { tip: r.tip } : {}) } : null
    case 'all': {
      if (!Array.isArray(r.of)) return null
      const of = r.of.map((c) => parseCheck(c, depth + 1))
      return of.length > 0 && of.every((c) => c !== null) ? { type: 'all', of: of as Check[] } : null
    }
    default:
      return null
  }
}

export const needsMoves = (check: Check | null | undefined): boolean => (check ? check.type === 'moved' || (check.type === 'all' && check.of.some(needsMoves)) : false)
export const needsOutput = (check: Check | null | undefined): boolean => (check ? check.type === 'output' || (check.type === 'all' && check.of.some(needsOutput)) : false)

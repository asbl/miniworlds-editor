import type { ClassModel } from '../uml/model'

/** miniworlds' `tools.api_index.build_index()`: per public class the members it defines itself. */
export interface ApiMember {
  name: string
  kind: 'method' | 'property'
  /** Methods: `(distance=1)`, without `self`. */
  signature?: string
  doc: string
}
export interface ApiClass {
  base: string | null
  kind: 'actor' | 'world'
  members: ApiMember[]
}
export interface ApiIndex {
  classes: Record<string, ApiClass>
}

export function parseIndex(json: string): ApiIndex | null {
  try {
    const raw = JSON.parse(json) as { classes?: Record<string, ApiClass> }
    return raw && typeof raw.classes === 'object' && raw.classes ? { classes: raw.classes } : null
  } catch {
    return null
  }
}

/** The class and its public bases, nearest first: Circle → Shape → Actor. */
export function chainOf(index: ApiIndex, name: string): string[] {
  const out: string[] = []
  let current: string | null = name
  while (current && index.classes[current] && !out.includes(current)) {
    out.push(current)
    current = (index.classes[current] as ApiClass).base
  }
  return out
}

/** Which engine class the class the cursor is in builds on: follows the pupil's own classes down to the engine. */
export function engineBaseOf(model: ClassModel | null, index: ApiIndex, userClass: string | null): string | null {
  if (!userClass) return null
  const seen = new Set<string>()
  let name: string | null = userClass
  while (name && !seen.has(name)) {
    seen.add(name)
    const info = model?.classes.find((c) => c.name === name)
    if (!info) return index.classes[name] ? name : (model?.libraries.find((l) => l.name === name)?.base ?? null)
    const next: string | undefined = info.bases.find((b) => index.classes[b] || model?.classes.some((c) => c.name === b) || model?.libraries.some((l) => l.name === b))
    if (!next) return null
    name = next
  }
  return null
}

export interface Row {
  from: string
  member: ApiMember
}

/** Members of the chain (own ones first, then inherited), filtered by a search text in the name or the doc line. */
export function membersOf(index: ApiIndex, chain: string[], query: string): Row[] {
  const needle = query.trim().toLowerCase()
  const seen = new Set<string>()
  const rows: Row[] = []
  for (const cls of chain) {
    for (const member of index.classes[cls]?.members ?? []) {
      if (seen.has(member.name)) continue
      seen.add(member.name)
      if (needle && !member.name.toLowerCase().includes(needle) && !member.doc.toLowerCase().includes(needle)) continue
      rows.push({ from: cls, member })
    }
  }
  return rows
}

/** The parameters of a signature `(a, b=1, *args)`: name and whether a value is required. */
export function parseSignature(signature: string | undefined): { name: string; required: boolean }[] {
  if (!signature) return []
  const inner = signature.trim().replace(/^\(/, '').replace(/\)$/, '')
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]
    if ('([{'.includes(c as string)) depth++
    else if (')]}'.includes(c as string)) depth--
    else if (c === ',' && depth === 0) {
      parts.push(inner.slice(start, i))
      start = i + 1
    }
  }
  parts.push(inner.slice(start))
  return parts
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith('*'))
    .map((p) => ({ name: (p.split('=')[0] as string).trim(), required: !p.includes('=') }))
}

/** What a click on "insert" puts into the code, in CodeMirror's snippet syntax (Tab jumps between the fields). */
export function snippetFor(member: ApiMember): string {
  if (member.kind === 'property') return `self.${member.name}`
  const required = parseSignature(member.signature).filter((p) => p.required)
  const fields = required.map((p, i) => `\${${i + 1}:${p.name}}`).join(', ')
  return `self.${member.name}(${fields})`
}

/** The line a pupil reads: `move(distance=1)`. */
export const labelOf = (member: ApiMember): string => (member.kind === 'property' ? member.name : `${member.name}${member.signature ?? '()'}`)

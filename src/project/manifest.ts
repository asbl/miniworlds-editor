import type { FileEntry } from '../workspace'
import { parseToml, stringifyToml } from './toml'

export const MANIFEST_FILE = 'project.toml'
export const ENTRY_DEFAULT = 'main.py'

/** `project` = project.toml present; `legacy` = a lone main.py (never migrated automatically). */
export type ProjectKind = 'project' | 'legacy' | 'empty' | 'other'

export interface Manifest {
  name: string
  /** Pinned miniworlds version, or null = "latest". */
  miniworlds: string | null
  entry: string
  packages: string[]
}

export function detectKind(entries: readonly FileEntry[]): ProjectKind {
  const files = new Set(entries.filter((e) => e.kind === 'file').map((e) => e.path))
  if (files.has(MANIFEST_FILE)) return 'project'
  if (files.has(ENTRY_DEFAULT)) return 'legacy'
  return files.size === 0 ? 'empty' : 'other'
}

export function parseManifest(text: string, fallbackName = ''): Manifest {
  const { tables, root } = parseToml(text)
  const project = tables.project ?? root
  const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null)
  const pkgs = tables.packages?.requires
  return {
    name: str(project.name) ?? fallbackName,
    miniworlds: str(project.miniworlds),
    entry: str(project.entry) ?? ENTRY_DEFAULT,
    packages: Array.isArray(pkgs) ? pkgs : [],
  }
}

export function serializeManifest(m: Manifest): string {
  const project: Record<string, string> = { name: m.name, entry: m.entry }
  if (m.miniworlds) project.miniworlds = m.miniworlds
  const tables: Record<string, Record<string, string[]>> = { project: project as never }
  if (m.packages.length > 0) tables.packages = { requires: m.packages }
  return stringifyToml({ root: {}, tables })
}

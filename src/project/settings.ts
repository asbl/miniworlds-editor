import type { Fs } from '../workspace'
import { ENTRY_DEFAULT, MANIFEST_FILE, parseManifest, serializeManifest, type ProjectKind } from './manifest'

/** What a project needs from the runtime: pinned engine version (null = newest) and extra packages. */
export interface ProjectSettings {
  miniworlds: string | null
  packages: string[]
}

export const DEFAULT_SETTINGS: ProjectSettings = { miniworlds: null, packages: [] }

/** Minimal storage for single-file projects, which have no project.toml (and are never migrated automatically). */
export interface KeyValue {
  get(key: string): string | null
  set(key: string, value: string): void
}

export function browserKeyValue(): KeyValue {
  const memory = new Map<string, string>()
  return {
    get(key) {
      try {
        return localStorage.getItem(key) ?? memory.get(key) ?? null
      } catch {
        return memory.get(key) ?? null
      }
    },
    set(key, value) {
      memory.set(key, value)
      try {
        localStorage.setItem(key, value)
      } catch {
        /* the choice then lasts until reload */
      }
    },
  }
}

const legacyKey = (project: string) => `miniworlds-editor.settings.${project}`

export async function loadSettings(fs: Fs, kind: ProjectKind, project: string, store: KeyValue): Promise<ProjectSettings> {
  if (kind === 'project') {
    try {
      const m = parseManifest(await fs.read(MANIFEST_FILE), project)
      return { miniworlds: m.miniworlds, packages: m.packages }
    } catch {
      return { ...DEFAULT_SETTINGS } // unreadable project.toml: run with defaults, do not crash the editor
    }
  }
  try {
    const raw = JSON.parse(store.get(legacyKey(project)) ?? '{}') as Partial<ProjectSettings>
    return {
      miniworlds: typeof raw.miniworlds === 'string' ? raw.miniworlds : null,
      packages: Array.isArray(raw.packages) ? raw.packages.filter((p): p is string => typeof p === 'string') : [],
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export async function saveSettings(fs: Fs, kind: ProjectKind, project: string, store: KeyValue, settings: ProjectSettings): Promise<void> {
  if (kind === 'project') {
    let manifest = { name: project, miniworlds: null as string | null, entry: ENTRY_DEFAULT, packages: [] as string[] }
    try {
      manifest = parseManifest(await fs.read(MANIFEST_FILE), project)
    } catch {
      /* rewrite a broken manifest from scratch */
    }
    await fs.write(MANIFEST_FILE, serializeManifest({ ...manifest, ...settings }))
  } else {
    store.set(legacyKey(project), JSON.stringify(settings))
  }
}

/** pip-style requirement lines are not validated here; micropip reports bad ones. Trim, drop empties and duplicates. */
export function cleanRequirements(list: readonly string[]): string[] {
  return [...new Set(list.map((r) => r.trim()).filter((r) => r !== ''))]
}

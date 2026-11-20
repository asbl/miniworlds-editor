const ROOMS = 'miniworlds-editor.collabRooms'
const NAME = 'miniworlds-editor.collabName'

function read(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(ROOMS) ?? '{}')
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === 'string')) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

/** Projects remember their room, so that a reload (or tomorrow) joins again. */
export const savedRoom = (project: string): string | null => read()[project] ?? null

export function rememberRoom(project: string, code: string | null): void {
  const all = read()
  if (code === null) delete all[project]
  else all[project] = code
  try {
    localStorage.setItem(ROOMS, JSON.stringify(all))
  } catch {
    /* private mode: the session just does not come back by itself */
  }
}

export function savedName(): string {
  try {
    return localStorage.getItem(NAME) ?? ''
  } catch {
    return ''
  }
}

export function rememberName(name: string): void {
  try {
    localStorage.setItem(NAME, name)
  } catch {
    /* ignore */
  }
}

const KNOWN = 'miniworlds-editor.collabKnown'

function readKnown(): Record<string, string[]> {
  try {
    const raw = JSON.parse(localStorage.getItem(KNOWN) ?? '{}')
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, string[]>) : {}
  } catch {
    return {}
  }
}

/** The files the room had when this project was last connected: what is missing from it now was deleted by somebody. */
export const knownPaths = (project: string): Set<string> => new Set((readKnown()[project] ?? []).filter((p) => typeof p === 'string'))

export function rememberKnown(project: string, paths: string[] | null): void {
  const all = readKnown()
  if (paths === null) delete all[project]
  else all[project] = paths
  try {
    localStorage.setItem(KNOWN, JSON.stringify(all))
  } catch {
    /* ignore */
  }
}

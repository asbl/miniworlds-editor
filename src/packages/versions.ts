/**
 * miniworlds version handling for the version picker and the update warning.
 * Facts (spike S5): PyPI's `releases` keys are NOT in version order ("4.4.0.9" comes after
 * "4.4.0.16"), so always sort numerically. Tested on Pyodide 0.29.3: all 38 wheels of 4.0.0.0 to 4.4.0.16
 * install and `import miniworlds`; all 22 of 3.x fail (missing packages such as easygui, syntax errors).
 * "Import works" is not "world runs": only the newest versions were exercised further.
 */

export interface PyPiFile {
  filename: string
  url: string
  size?: number
  yanked?: boolean
}
export interface PyPiProject {
  info: { version: string }
  releases: Record<string, PyPiFile[]>
}

/** Support level of an engine version inside the editor. */
export type EngineTier =
  /** Runs, with Miniworlds view and code hints (ScenarioHost, class_model, code_hints). */
  | 'full'
  /** Runs, but without the Miniworlds view and miniworlds hints. */
  | 'basic'
  /** Cannot run in the browser. */
  | 'unsupported'

export interface EngineVersion {
  version: string
  wheelUrl: string
  size: number
  tier: EngineTier
}

export const MIN_FULL = '4.4.0.15'
export const MIN_RUNNABLE = '4.0.0.0'

/** Numeric parts, or null for anything that is not plain dotted digits (pre-releases, local versions). */
export function parseVersion(version: string): number[] | null {
  if (!/^\d+(\.\d+)*$/.test(version)) return null
  return version.split('.').map(Number)
}

export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!x || !y) throw new Error(`Keine gültige Versionsnummer: ${!x ? a : b}`)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

export function engineTier(version: string): EngineTier {
  if (compareVersions(version, MIN_FULL) >= 0) return 'full'
  if (compareVersions(version, MIN_RUNNABLE) >= 0) return 'basic'
  return 'unsupported'
}

/** All installable versions (pure wheel, not yanked, plain release number), newest first. */
export function availableVersions(project: PyPiProject, includeUnsupported = false): EngineVersion[] {
  const out: EngineVersion[] = []
  for (const [version, files] of Object.entries(project.releases)) {
    if (!parseVersion(version)) continue
    const wheel = files.find((f) => f.filename.endsWith('-py3-none-any.whl') && !f.yanked)
    if (!wheel) continue
    const tier = engineTier(version)
    if (tier === 'unsupported' && !includeUnsupported) continue
    out.push({ version, wheelUrl: wheel.url, size: wheel.size ?? 0, tier })
  }
  return out.sort((a, b) => compareVersions(b.version, a.version))
}

export function latestVersion(project: PyPiProject): EngineVersion | null {
  return availableVersions(project)[0] ?? null
}

export type UpdateStatus =
  | { kind: 'current' }
  | { kind: 'update-available'; latest: string; tier: EngineTier }
  /** Offline or PyPI unreachable: say nothing instead of warning wrongly. */
  | { kind: 'unknown' }

export function updateStatus(installed: string, latest: string | null): UpdateStatus {
  if (latest === null || !parseVersion(installed)) return { kind: 'unknown' }
  return compareVersions(latest, installed) > 0
    ? { kind: 'update-available', latest, tier: engineTier(installed) }
    : { kind: 'current' }
}

const PYPI_URL = 'https://pypi.org/pypi/miniworlds/json'

/** Fetches the project metadata; returns null when offline/unreachable (the Service Worker may answer from cache). */
export async function fetchProject(fetchImpl: typeof fetch = fetch): Promise<PyPiProject | null> {
  try {
    const res = await fetchImpl(PYPI_URL)
    return res.ok ? ((await res.json()) as PyPiProject) : null
  } catch {
    return null
  }
}

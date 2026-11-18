import { RUNTIME_PACKAGES } from './config'

/** The files Pyodide itself needs before it can start (the worker fetches the same addresses later). */
const CORE_FILES = ['pyodide.mjs', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip']

interface Lock {
  packages?: Record<string, { file_name?: string; depends?: string[] }>
}

const normalize = (name: string) => name.toLowerCase().replace(/[-_.]+/g, '-')

/** The package files to download for `wanted` (with everything they depend on), as paths relative to the Pyodide base. */
export function packageFiles(lock: Lock, wanted: readonly string[]): string[] {
  const byName = new Map(Object.entries(lock.packages ?? {}).map(([name, info]) => [normalize(name), info]))
  const files = new Set<string>()
  const seen = new Set<string>()
  const visit = (name: string) => {
    const key = normalize(name)
    if (seen.has(key)) return
    seen.add(key)
    const info = byName.get(key)
    if (!info) return
    if (info.file_name) files.add(info.file_name)
    for (const dependency of info.depends ?? []) visit(dependency)
  }
  wanted.forEach(visit)
  return [...files]
}

/**
 * Starts downloading what the first "Run" needs while the page itself is still starting: Pyodide's core files and the
 * packages the world worker loads. The browser keeps them in its HTTP cache, so the worker's own requests for the same
 * addresses are answered from there. Purely an optimisation: every failure is swallowed, and the worker still fetches
 * whatever is missing.
 */
export async function prefetchRuntime(base: string, fetcher: typeof fetch = fetch, packages: readonly string[] = RUNTIME_PACKAGES): Promise<void> {
  const get = async (path: string): Promise<Response | null> => {
    try {
      const response = await fetcher(base + path)
      if (!response.ok) return null
      await response.clone().arrayBuffer() // the body has to be read to the end for the cache to keep it
      return response
    } catch {
      return null
    }
  }
  const lock = get('pyodide-lock.json').then(async (response) => {
    const parsed = response ? ((await response.json().catch(() => null)) as Lock | null) : null
    await Promise.all(packageFiles(parsed ?? {}, packages).map(get))
  })
  await Promise.all([...CORE_FILES.map(get), lock])
}

/** Not on a metered connection or when the browser asks to save data: the pupil's first Run fetches what it needs anyway. */
export function prefetchAllowed(connection: { saveData?: boolean } | undefined = (navigator as { connection?: { saveData?: boolean } }).connection): boolean {
  return connection?.saveData !== true
}

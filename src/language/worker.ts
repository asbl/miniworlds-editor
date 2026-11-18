import ruffWasmUrl from '@astral-sh/ruff-wasm-web/ruff_wasm_bg.wasm?url'
import { LANGUAGE_PACKAGES } from '../runtime/config'
import assistSource from './assist.py?raw'
import type { FromLanguage, ToLanguage } from './protocol'

/** Minimal view of what is used from Pyodide and ruff-wasm. */
interface Pyodide {
  FS: { writeFile(path: string, data: Uint8Array): void }
  globals: { set(name: string, value: unknown): void }
  runPython(code: string): unknown
  runPythonAsync(code: string): Promise<unknown>
  loadPackage(names: string[]): Promise<unknown>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pyimport(name: string): any
}
interface RuffWorkspace {
  check(source: string): unknown
  format(source: string): string
}

const post = (message: FromLanguage) => (self as unknown as Worker).postMessage(message)
const scope = self as unknown as { onmessage: ((e: MessageEvent<ToLanguage>) => void) | null }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let assist: any = null
let ruff: RuffWorkspace | null = null
let queue: Promise<unknown> = Promise.resolve()
/** Newest request id per kind: while the worker is busy, answers nobody waits for any more are not computed. */
const newest = new Map<string, number>()

async function bootPython(pyodideBase: string, miniworlds: string | null): Promise<{ hints: boolean; version: string | null }> {
  const { loadPyodide } = (await import(/* @vite-ignore */ `${pyodideBase}pyodide.mjs`)) as { loadPyodide(o: { indexURL: string }): Promise<Pyodide> }
  const py = await loadPyodide({ indexURL: pyodideBase })
  await py.loadPackage(LANGUAGE_PACKAGES)
  // dependencies off: pygame and numpy stay out of this interpreter (see assist.py)
  py.globals.set('SPEC', miniworlds ? `miniworlds==${miniworlds}` : 'miniworlds')
  await py.runPythonAsync('import micropip\nawait micropip.install(SPEC, deps=False)')
  py.FS.writeFile('/home/pyodide/mw_assist.py', new TextEncoder().encode(assistSource))
  py.runPython('import sys\nif "/home/pyodide" not in sys.path: sys.path.insert(0, "/home/pyodide")')
  assist = py.pyimport('mw_assist')
  const hints = (JSON.parse(assist.setup() as string) as { hints: boolean }).hints
  try {
    assist.complete('warmup.py', 'import miniworlds as mw\nmw.', 2, 3) // the first jedi call parses the package: do it now
  } catch {
    /* completion still works later */
  }
  const version = py.runPython('import importlib.metadata as m\nm.version("miniworlds")') as string | null
  return { hints, version }
}

async function bootRuff(): Promise<void> {
  const mod = await import('@astral-sh/ruff-wasm-web')
  await mod.default({ module_or_path: ruffWasmUrl })
  ruff = new mod.Workspace({ 'line-length': 88, lint: { select: ['E4', 'E7', 'E9', 'F'] } }, mod.PositionEncoding.Utf16) as unknown as RuffWorkspace
}

async function handle(message: ToLanguage): Promise<void> {
  switch (message.type) {
    case 'boot': {
      // ruff is bundled and needs no network: it stays usable when Python (CDN, PyPI) cannot be loaded, e.g. offline
      const [python, ruffOk] = await Promise.all([
        bootPython(message.pyodideBase, message.miniworlds).then(
          (booted) => booted,
          (error) => ({ error: String((error as Error)?.stack ?? error) }),
        ),
        bootRuff().then(
          () => true,
          () => false,
        ),
      ])
      if ('error' in python) {
        console.warn('Language worker: Python part failed', python.error)
        if (!ruffOk) return post({ type: 'boot-error', text: python.error })
        assist = null
        return post({ type: 'ready', hints: false, ruff: true, python: false, version: null })
      }
      return post({ type: 'ready', hints: python.hints, ruff: ruffOk, python: true, version: python.version })
    }
    case 'api':
      try {
        assist?.set_api(message.index)
      } catch (error) {
        console.warn('Language worker: api index rejected', error)
      }
      return
    case 'sync':
      try {
        assist?.sync(JSON.stringify(message.files))
      } catch (error) {
        console.warn('Language worker: sync failed', error)
      }
      return
    case 'req': {
      if (newest.get(message.name) !== message.id && message.name !== 'format') {
        post({ type: 'res', id: message.id, ok: true, value: null }) // superseded by a newer request of the same kind
        return
      }
      try {
        let value: unknown = null
        const a = message.args
        if (message.name === 'lint') value = ruff ? ruff.check(a[0] as string) : []
        else if (message.name === 'format') value = ruff ? ruff.format(a[0] as string) : null
        else if (assist) {
          const json = assist[message.name](...a) as string
          value = JSON.parse(json)
        }
        post({ type: 'res', id: message.id, ok: true, value })
      } catch (error) {
        post({ type: 'res', id: message.id, ok: false, error: String((error as Error)?.message ?? error) })
      }
    }
  }
}

// one message at a time, in order (sync must be applied before the completion that follows it)
scope.onmessage = ({ data }) => {
  if (data.type === 'req') newest.set(data.name, data.id)
  // a failing handler must never break the chain: later messages still get answered
  queue = queue.then(() => handle(data)).catch((error) => console.warn('Language worker', error))
}

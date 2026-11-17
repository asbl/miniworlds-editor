import runnerSource from './runner.py?raw'
import type { BootStep, FileChanges, FromWorker, ToWorker } from './protocol'

/** Minimal view of the Pyodide API that this file uses (pyodide is loaded from a URL at runtime, not bundled). */
interface Pyodide {
  FS: {
    mkdir(path: string): void
    writeFile(path: string, data: Uint8Array): void
    readFile(path: string): Uint8Array
    readdir(path: string): string[]
    stat(path: string): { mode: number; size: number; mtime: Date }
    isDir(mode: number): boolean
    analyzePath(path: string): { exists: boolean }
  }
  canvas: { setCanvas2D(canvas: OffscreenCanvas): void }
  globals: { get(name: string): unknown }
  runPython(code: string): unknown
  runPythonAsync(code: string): Promise<unknown>
  loadPackage(names: string[]): Promise<unknown>
  pyimport(name: string): any // eslint-disable-line @typescript-eslint/no-explicit-any -- proxy of a Python module
  setStdout(options: { batched: (text: string) => void }): void
  setStderr(options: { batched: (text: string) => void }): void
}

const ROOT = '/project'
const post = (message: FromWorker, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(message, transfer)
const scopeSelf = self as unknown as { onmessage: ((e: MessageEvent<ToWorker>) => void) | null }

// SDL's emscripten backend expects a DOM. Minimal stand-ins so registration succeeds (see PLAN S3);
// real input arrives as 'input' messages and is injected with pygame.event.post.
const scope = self as unknown as Record<string, unknown>
if (typeof scope.document === 'undefined') {
  const doc = new EventTarget()
  Object.assign(doc, {
    pointerLockElement: null,
    fullscreenElement: null,
    body: {},
    querySelector: () => null,
    getElementById: () => scope.__canvas ?? null,
    hasFocus: () => true,
  })
  scope.document = doc
}
if (typeof scope.screen === 'undefined') scope.screen = { width: 1920, height: 1080, availWidth: 1920, availHeight: 1080 }

let pyodide: Pyodide | null = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let runner: any = null
let baseline = new Map<string, string>()

function ensureDir(path: string) {
  const fs = (pyodide as Pyodide).FS
  let current = ''
  for (const part of path.split('/').filter(Boolean)) {
    current += '/' + part
    if (!fs.analyzePath(current).exists) fs.mkdir(current)
  }
}

/** "path → mtime:size" of every project file; the diff against the baseline is what the program wrote. */
function snapshot(): Map<string, string> {
  const fs = (pyodide as Pyodide).FS
  const out = new Map<string, string>()
  const walk = (dir: string, prefix: string) => {
    for (const name of fs.readdir(dir)) {
      if (name === '.' || name === '..' || name === '__pycache__') continue
      const full = `${dir}/${name}`
      const st = fs.stat(full)
      if (fs.isDir(st.mode)) walk(full, `${prefix}${name}/`)
      else out.set(`${prefix}${name}`, `${st.mtime.getTime()}:${st.size}`)
    }
  }
  if (fs.analyzePath(ROOT).exists) walk(ROOT, '')
  return out
}

function collectChanges(): FileChanges & { transfer: Transferable[] } {
  const fs = (pyodide as Pyodide).FS
  const after = snapshot()
  const changed: Record<string, ArrayBuffer> = {}
  const transfer: Transferable[] = []
  for (const [path, sig] of after) {
    if (baseline.get(path) === sig) continue
    const bytes = fs.readFile(`${ROOT}/${path}`)
    const copy = bytes.slice().buffer as ArrayBuffer
    changed[path] = copy
    transfer.push(copy)
  }
  const deleted = [...baseline.keys()].filter((p) => !after.has(p))
  baseline = after
  return { changed, deleted, transfer }
}

// Python → JS notifications (see runner.py)
scope._mw_notify = (kind: string, payload: string) => {
  const value = JSON.parse(payload) as string | null
  if (kind === 'notice') {
    post({ type: 'notice', code: value as 'silent-audio' })
  } else if (kind === 'exit') {
    const { transfer, ...changes } = collectChanges()
    post({ type: 'exit', error: value, ...changes }, transfer)
  }
}

const progress = (step: BootStep) => post({ type: 'progress', step })

async function boot(message: Extract<ToWorker, { type: 'boot' }>): Promise<string> {
  const { canvas, pyodideBase, miniworlds, packages } = message
  scope.__canvas = canvas
  // SDL treats the canvas like an HTMLCanvasElement: give the OffscreenCanvas the bits it touches.
  Object.assign(canvas, { style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: canvas.width, height: canvas.height }), focus: () => {} })

  progress('pyodide')
  const { loadPyodide } = (await import(/* @vite-ignore */ `${pyodideBase}pyodide.mjs`)) as {
    loadPyodide(options: { indexURL: string }): Promise<Pyodide>
  }
  const py = await loadPyodide({ indexURL: pyodideBase })
  pyodide = py
  const hasAudio = typeof (self as unknown as { AudioContext?: unknown }).AudioContext !== 'undefined'
  py.runPython(
    `import os\nos.environ["SDL_EMSCRIPTEN_KEYBOARD_ELEMENT"] = "#canvas"\n` + (hasAudio ? '' : `os.environ["SDL_AUDIODRIVER"] = "dummy"\n`),
  )
  py.canvas.setCanvas2D(canvas)

  progress('packages')
  await py.loadPackage(['micropip', 'numpy', 'pygame-ce'])
  const micropip = py.pyimport('micropip')
  progress('miniworlds')
  await micropip.install(miniworlds ? `miniworlds==${miniworlds}` : 'miniworlds')
  if (packages.length > 0) {
    progress('extra')
    await micropip.install(packages)
  }
  // The lifecycle helpers are a normal Python module so that tracebacks and imports behave as usual.
  py.FS.writeFile('/home/pyodide/mw_runner.py', new TextEncoder().encode(runnerSource))
  py.runPython(`import sys\nif "/home/pyodide" not in sys.path: sys.path.insert(0, "/home/pyodide")`)
  runner = py.pyimport('mw_runner')
  runner.setup(hasAudio)
  // Only the program's output belongs in the console, not Pyodide's loading messages or the pygame banner.
  py.setStdout({ batched: (text) => post({ type: 'out', stream: 'stdout', text }) })
  py.setStderr({ batched: (text) => post({ type: 'out', stream: 'stderr', text }) })
  return py.runPython(`import importlib.metadata as m\nm.version("miniworlds")`) as string
}

const toBytes = (buffer: ArrayBuffer) => new Uint8Array(buffer)

async function run(message: Extract<ToWorker, { type: 'run' }>) {
  const py = pyodide as Pyodide
  runner.reset_project()
  for (const [path, buffer] of Object.entries(message.files)) {
    const dir = path.split('/').slice(0, -1).join('/')
    ensureDir(`${ROOT}/${dir}`)
    py.FS.writeFile(`${ROOT}/${path}`, toBytes(buffer))
  }
  baseline = snapshot()
  try {
    await py.runPythonAsync(`import mw_runner\nawait mw_runner.run(${JSON.stringify(message.entry)})`)
  } catch (error) {
    // Failures outside the program (the runner itself); the program's own errors arrive via 'exit'.
    const { transfer, ...changes } = collectChanges()
    post({ type: 'exit', error: String(error), ...changes }, transfer)
  }
}

async function stop() {
  const py = pyodide as Pyodide
  try {
    await py.runPythonAsync('import mw_runner\nawait mw_runner.stop()')
  } finally {
    const { transfer, ...changes } = collectChanges()
    post({ type: 'stopped', ...changes }, transfer)
  }
}

async function install(requirement: string) {
  const py = pyodide as Pyodide
  try {
    await py.pyimport('micropip').install(requirement)
    py.runPython('import importlib\nimportlib.invalidate_caches()')
    post({ type: 'installed', requirement, ok: true })
  } catch (error) {
    post({ type: 'installed', requirement, ok: false, error: String((error as Error)?.message ?? error) })
  }
}

scopeSelf.onmessage = async ({ data }: MessageEvent<ToWorker>) => {
  switch (data.type) {
    case 'boot':
      try {
        post({ type: 'ready', version: await boot(data) })
      } catch (error) {
        post({ type: 'boot-error', text: String((error as Error)?.stack ?? error) })
      }
      break
    case 'run':
      await run(data)
      break
    case 'stop':
      await stop()
      break
    case 'install':
      await install(data.requirement)
      break
    case 'input':
      if (runner) runner.post_input(JSON.stringify(data.event))
      break
  }
}

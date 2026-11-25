import runnerSource from './runner.py?raw'
import traceSource from './trace.py?raw'
import liveSource from './livepatch.py?raw'
import { RUNTIME_PACKAGES } from './config'
import type { BootStep, FileChanges, FromWorker, ToWorker, TraceBatch } from './protocol'

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
  if (kind === 'trace') {
    post({ type: 'trace', ...(value as unknown as TraceBatch) })
  } else if (kind === 'scenario-ready') {
    post({ type: 'scenario-ready' })
  } else if (kind === 'notice') {
    post({ type: 'notice', code: value as 'silent-audio' })
  } else if (kind === 'exit') {
    const { transfer, ...changes } = collectChanges()
    post({ type: 'exit', error: value, ...changes }, transfer)
  }
}

// input(): the program blocks until the page sends a line. Two ways to block without SharedArrayBuffer (which would need
// cross-origin isolation and so break embedding): JSPI (Chromium) suspends Python while the worker stays responsive;
// elsewhere a synchronous request that the Service Worker holds open until the page posts the line.
let inputBase: string | null = null
let inputSeq = 0
const inputWaiters = new Map<string, (text: string | null) => void>()
const nextInputId = () => `${Math.random().toString(36).slice(2, 8)}-${++inputSeq}`

scope._mw_read_line = (prompt: string) =>
  new Promise<string | null>((resolve) => {
    const id = nextInputId()
    inputWaiters.set(id, resolve)
    post({ type: 'input-request', id, prompt, via: 'worker' })
  })

scope._mw_sync_input_ready = () => inputBase !== null && !!(navigator as Navigator).serviceWorker?.controller

scope._mw_read_line_sync = (prompt: string): string | null => {
  const id = nextInputId()
  post({ type: 'input-request', id, prompt, via: 'service-worker' })
  try {
    const request = new XMLHttpRequest()
    request.open('GET', `${inputBase}${id}`, false)
    request.send()
    if (request.status !== 200) return null
    return (JSON.parse(request.responseText) as { text: string | null }).text
  } catch {
    return null
  }
}

/** pygame.display.set_mode was called: SDL does not resize an OffscreenCanvas by itself, so the worker does and tells the page. */
scope._mw_canvas_size = (width: number, height: number) => {
  const canvas = scope.__canvas as OffscreenCanvas | undefined
  if (!canvas || width <= 0 || height <= 0) return
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
  post({ type: 'canvas-size', width, height })
}

/** Sound: the page plays it (see audio.ts). `data` is the file's bytes, sent only the first time. */
scope._mw_audio = (json: string, data?: Uint8Array | null) => {
  const message = JSON.parse(json) as Record<string, unknown>
  if (data) {
    const copy = data.slice().buffer as ArrayBuffer
    post({ type: 'audio', ...message, data: copy } as FromWorker, [copy])
  } else post({ type: 'audio', ...message } as FromWorker)
}

/** The page cancelled (Stop): every waiting `input()` ends. */
function cancelInputs() {
  for (const resolve of inputWaiters.values()) resolve(null)
  inputWaiters.clear()
}

const progress = (step: BootStep) => post({ type: 'progress', step })

async function boot(message: Extract<ToWorker, { type: 'boot' }>): Promise<string> {
  const { canvas, pyodideBase, miniworlds, packages } = message
  inputBase = message.inputBase
  scope.__canvas = canvas
  // SDL treats the canvas like an HTMLCanvasElement: give the OffscreenCanvas the bits it touches.
  Object.assign(canvas, { style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: canvas.width, height: canvas.height }), focus: () => {} })

  progress('pyodide')
  const { loadPyodide } = (await import(/* @vite-ignore */ `${pyodideBase}pyodide.mjs`)) as {
    loadPyodide(options: { indexURL: string }): Promise<Pyodide>
  }
  const py = await loadPyodide({ indexURL: pyodideBase })
  pyodide = py
  // an AudioContext in the worker (not in today's browsers) would let SDL play by itself; otherwise the page plays, if it can
  const hasAudio = typeof (self as unknown as { AudioContext?: unknown }).AudioContext !== 'undefined'
  py.runPython(
    `import os\nos.environ["SDL_EMSCRIPTEN_KEYBOARD_ELEMENT"] = "#canvas"\n` + (hasAudio ? '' : `os.environ["SDL_AUDIODRIVER"] = "dummy"\n`),
  )
  py.canvas.setCanvas2D(canvas)

  progress('packages')
  await py.loadPackage(RUNTIME_PACKAGES)
  const micropip = py.pyimport('micropip')
  progress('miniworlds')
  await micropip.install(miniworlds ? `miniworlds==${miniworlds}` : 'miniworlds')
  if (packages.length > 0) {
    progress('extra')
    await micropip.install(packages)
  }
  // The lifecycle helpers are a normal Python module so that tracebacks and imports behave as usual.
  py.FS.writeFile('/home/pyodide/mw_runner.py', new TextEncoder().encode(runnerSource))
  py.FS.writeFile('/home/pyodide/mw_trace.py', new TextEncoder().encode(traceSource))
  py.FS.writeFile('/home/pyodide/mw_live.py', new TextEncoder().encode(liveSource))
  py.runPython(`import sys\nif "/home/pyodide" not in sys.path: sys.path.insert(0, "/home/pyodide")`)
  runner = py.pyimport('mw_runner')
  runner.setup(hasAudio, message.audio)
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
    await py.runPythonAsync(`import mw_runner\nawait mw_runner.run(${JSON.stringify(message.entry)}, ${message.scenario ? 'True' : 'False'})`)
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
        const text = String((error as Error)?.stack ?? error)
        // a policy that forbids eval shows up as pygame failing to load ("does not define module export function (PyInit_…)")
        post({ type: 'boot-error', text, hint: /PyInit_|unsafe-eval|Content Security Policy|call to eval\(\)/i.test(text) ? 'blocked' : undefined })
      }
      break
    case 'run':
      await run(data)
      break
    case 'input-reply':
      inputWaiters.get(data.id)?.(data.text)
      inputWaiters.delete(data.id)
      break
    case 'stop':
      cancelInputs()
      await stop()
      break
    case 'install':
      await install(data.requirement)
      break
    case 'rpc':
      post({ type: 'rpc-result', id: data.id, reply: JSON.parse(runner.rpc(data.name, JSON.stringify(data.args)) as string) })
      break
    case 'snapshot': {
      const canvas = scope.__canvas as OffscreenCanvas | undefined
      const png = await canvas?.convertToBlob({ type: 'image/png' }).then((blob) => blob.arrayBuffer()).catch(() => null)
      post({ type: 'snapshot-result', id: data.id, png: png ?? null }, png ? [png] : [])
      break
    }
    case 'input':
      if (runner) runner.post_input(JSON.stringify(data.event))
      break
  }
}

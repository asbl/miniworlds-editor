// S4: bring an OPFS project into the Emscripten FS. Strategies:
//   A  copy-in, worker reads OPFS directly
//   B  pyodide.mountNativeFS on an OPFS directory handle
//   C  main thread reads through the Workspace-like API and posts {path: bytes} (the architecture we actually want)
const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.29.3/full/pyodide.mjs'
let pyodide

const now = () => performance.now()
const log = (text) => self.postMessage({ type: 'log', text })

async function boot() {
  const t0 = now()
  const { loadPyodide } = await import(PYODIDE)
  pyodide = await loadPyodide()
  return now() - t0
}

// ---- OPFS helpers (worker side) ----
async function opfsProject(name) {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(name, { create: true })
}
async function removeProject(name) {
  const root = await navigator.storage.getDirectory()
  try { await root.removeEntry(name, { recursive: true }) } catch {}
}
async function writeFile(dir, path, data) {
  const parts = path.split('/')
  for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create: true })
  const fh = await dir.getFileHandle(parts.at(-1), { create: true })
  const w = await fh.createWritable()
  await w.write(data)
  await w.close()
}

// Synthetic project: `classes` python files + `images` binary assets of `kb` KB each.
function synth({ classes, images, kb }) {
  const files = {}
  const enc = new TextEncoder()
  for (let i = 0; i < classes; i++) {
    files[`classes/Actor${i}.py`] = enc.encode(
      `class Actor${i}:\n    def __init__(self):\n        self.value = ${i}\n\n    def act(self):\n        return self.value\n`.repeat(8))
  }
  files['classes/__init__.py'] = enc.encode('')
  files['main.py'] = enc.encode(
    `import importlib, pkgutil, classes\nmods = [importlib.import_module('classes.' + m.name) for m in pkgutil.iter_modules(classes.__path__)]\nresult = len(mods)\n`)
  files['project.toml'] = enc.encode('name = "bench"\nminiworlds = "4.4.0.16"\n')
  const blob = new Uint8Array(kb * 1024)
  for (let i = 0; i < images; i++) {
    blob.fill(i & 255)
    files[`images/img${i}.png`] = blob.slice()
  }
  return files
}
const totalBytes = (files) => Object.values(files).reduce((s, b) => s + b.byteLength, 0)

async function seed(name, spec) {
  await removeProject(name)
  const dir = await opfsProject(name)
  const files = synth(spec)
  const t0 = now()
  for (const [p, b] of Object.entries(files)) await writeFile(dir, p, b)
  return { files, seedMs: now() - t0 }
}

function ensureDir(path) {
  const parts = path.split('/').filter(Boolean)
  let cur = ''
  for (const p of parts) {
    cur += '/' + p
    if (!pyodide.FS.analyzePath(cur).exists) pyodide.FS.mkdir(cur)
  }
}
function fsWipe(path) {
  if (!pyodide.FS.analyzePath(path).exists) return
  for (const e of pyodide.FS.readdir(path)) {
    if (e === '.' || e === '..') continue
    const p = `${path}/${e}`
    if (pyodide.FS.isDir(pyodide.FS.stat(p).mode)) { fsWipe(p); pyodide.FS.rmdir(p) } else pyodide.FS.unlink(p)
  }
}

// Re-runs in a warm worker: drop modules that came from the project, otherwise edits are invisible.
async function startProject(root) {
  const t0 = now()
  pyodide.runPython(`import sys, importlib
if "${root}" not in sys.path: sys.path.insert(0, "${root}")
for name, mod in list(sys.modules.items()):
    f = getattr(mod, "__file__", None) or ""
    if f.startswith("/home/pyodide/proj"):
        del sys.modules[name]
importlib.invalidate_caches()`)
  await pyodide.runPythonAsync(`exec(open("${root}/main.py").read())`)
  return { n: pyodide.globals.get('result'), ms: now() - t0 }
}

// ---- strategy A ----
async function walk(dir, prefix, out) {
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'directory') await walk(handle, `${prefix}${name}/`, out)
    else out.push([`${prefix}${name}`, handle])
  }
}
async function strategyA(name) {
  const t0 = now()
  const dir = await opfsProject(name)
  const list = []
  await walk(dir, '', list)
  const tList = now()
  const root = '/home/pyodide/projA'
  fsWipe(root); ensureDir(root)
  let bytes = 0
  for (const [path, handle] of list) {
    const buf = new Uint8Array(await (await handle.getFile()).arrayBuffer())
    ensureDir(`${root}/${path.split('/').slice(0, -1).join('/')}`)
    pyodide.FS.writeFile(`${root}/${path}`, buf)
    bytes += buf.byteLength
  }
  const copyMs = now() - t0
  const run = await startProject(root)
  return { listMs: tList - t0, copyMs, startMs: run.ms, totalMs: now() - t0, files: list.length, bytes, modules: run.n }
}

// ---- strategy B ----
async function strategyB(name) {
  const t0 = now()
  const dir = await opfsProject(name)
  const root = '/home/pyodide/projB'
  ensureDir(root)
  const mount = await pyodide.mountNativeFS(root, dir)
  const mountMs = now() - t0
  const run = await startProject(root)
  // write-back test: Python writes a file, syncfs flushes it to OPFS
  pyodide.runPython(`open("${root}/saved_world.json", "w").write('{"actors": []}')`)
  const s0 = now()
  await mount.syncfs()
  const syncMs = now() - s0
  const back = await (await (await dir.getFileHandle('saved_world.json')).getFile()).text()
  return { mountMs, startMs: run.ms, totalMs: now() - t0, syncMs, writeBackOk: back === '{"actors": []}', modules: run.n }
}

// ---- strategy C ----
function strategyCApply(files) {
  const t0 = now()
  const root = '/home/pyodide/projC'
  fsWipe(root); ensureDir(root)
  for (const [path, buf] of Object.entries(files)) {
    ensureDir(`${root}/${path.split('/').slice(0, -1).join('/')}`)
    pyodide.FS.writeFile(`${root}/${path}`, new Uint8Array(buf))
  }
  return { applyMs: now() - t0, root }
}

// Manifest of the project as applied (path -> "mtime:size"); after a run, diff against it to find what Python wrote.
function manifest(root) {
  const out = {}
  const walkFs = (dir, prefix) => {
    for (const e of pyodide.FS.readdir(dir)) {
      if (e === '.' || e === '..' || e === '__pycache__') continue
      const p = `${dir}/${e}`
      const st = pyodide.FS.stat(p)
      if (pyodide.FS.isDir(st.mode)) walkFs(p, `${prefix}${e}/`)
      else out[`${prefix}${e}`] = `${st.mtime.getTime()}:${st.size}`
    }
  }
  walkFs(root, '')
  return out
}
function collectChanged(root, before) {
  const after = manifest(root)
  const out = {}
  for (const [path, sig] of Object.entries(after)) {
    if (before[path] !== sig) out[path] = pyodide.FS.readFile(`${root}/${path}`)
  }
  const deleted = Object.keys(before).filter((p) => !(p in after))
  return { changed: out, deleted }
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'boot') {
      self.postMessage({ type: 'booted', ms: await boot() })
    } else if (data.type === 'seed') {
      const { seedMs } = await seed(data.name, data.spec)
      self.postMessage({ type: 'seeded', seedMs })
    } else if (data.type === 'A') {
      self.postMessage({ type: 'result', strategy: 'A', ...(await strategyA(data.name)) })
    } else if (data.type === 'B') {
      self.postMessage({ type: 'result', strategy: 'B', ...(await strategyB(data.name)) })
    } else if (data.type === 'C') {
      const { applyMs, root } = strategyCApply(data.files)
      const run = await startProject(root)
      const before = manifest(root)
      pyodide.runPython(`import os\nopen("${root}/saved_world.json", "w").write('{"actors": []}')\nopen("${root}/classes/Actor0.py", "a").write("# edited by python\\n")\nos.remove("${root}/project.toml")`)
      const c0 = now()
      const { changed, deleted } = collectChanged(root, before)
      // edit a class and run again in the same worker: must see the new code
      pyodide.FS.writeFile(`${root}/classes/Actor1.py`, new TextEncoder().encode('class Actor1:\n    value = 4711\n'))
      pyodide.FS.writeFile(`${root}/main.py`, new TextEncoder().encode(
        'import classes.Actor1 as a\nresult = a.Actor1.value\n'))
      const rerun = await startProject(root)
      self.postMessage({ type: 'result', strategy: 'C', applyMs, startMs: run.ms, modules: run.n,
        changedFiles: Object.keys(changed), deleted, collectMs: now() - c0, rerunMs: rerun.ms, rerunSawEdit: rerun.n === 4711 })
    }
  } catch (error) {
    self.postMessage({ type: 'error', text: String(error?.stack ?? error) })
  }
}

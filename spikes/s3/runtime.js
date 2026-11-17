// Shared by main thread and worker: boot Pyodide, run a benchmark scene, read results.
const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.29.3/full/pyodide.mjs'

export async function latestWheel() {
  const meta = await (await fetch('https://pypi.org/pypi/miniworlds/json')).json()
  const files = meta.releases[meta.info.version] ?? meta.urls
  return files.find((f) => /-py3-none-any\.whl$/i.test(f.filename)).url
}

export async function boot(canvas, log) {
  const t0 = performance.now()
  const { loadPyodide } = await import(PYODIDE)
  const pyodide = await loadPyodide()
  pyodide.setStdout({ batched: (t) => log(t) })
  pyodide.setStderr({ batched: (t) => log('ERR ' + t) })
  pyodide.runPython('import os\nos.environ["SDL_EMSCRIPTEN_KEYBOARD_ELEMENT"] = "#canvas"')
  // Workers have no AudioContext: SDL audio cannot work there (finding), fall back to the dummy driver.
  const hasAudio = typeof AudioContext !== 'undefined'
  log(`AudioContext in this realm: ${hasAudio}`)
  if (!hasAudio) pyodide.runPython('os.environ["SDL_AUDIODRIVER"] = "dummy"')
  pyodide.canvas.setCanvas2D(canvas)
  await pyodide.loadPackage(['micropip', 'numpy', 'pygame-ce'])
  const mp = pyodide.pyimport('micropip')
  await mp.install([await latestWheel()])
  log(`boot ${(performance.now() - t0).toFixed(0)} ms`)
  return pyodide
}

export async function runScene(pyodide, scene, seconds) {
  const code = await (await fetch(new URL('bench.py', import.meta.url))).text()
  pyodide.globals.set('SCENE', scene)
  await pyodide.runPythonAsync(code)
  await new Promise((r) => setTimeout(r, seconds * 1000))
  return JSON.parse(pyodide.runPython('summary()'))
}

// Proof: a LIGHT Pyodide (no pygame/numpy) can run miniworlds' code_hints/class_model with a precomputed API index.
import { loadPyodide } from 'pyodide'
import { BAD } from './sample.mjs'

const meta = await (await fetch('https://pypi.org/pypi/miniworlds/json')).json()
const WHEEL = meta.releases[meta.info.version].find((f) => /py3-none-any\.whl$/.test(f.filename)).url

// 1) full runtime builds the index once (in the product: at build time or on the world worker, then cached per version)
const full = await loadPyodide()
await full.loadPackage(['micropip', 'numpy', 'pygame-ce'])
full.globals.set('WHEEL', WHEEL)
await full.runPythonAsync('import micropip; await micropip.install(WHEEL)')
const index = full.runPython('import json\nfrom miniworlds.tools import api_index\njson.dumps(api_index.build_index())')
console.log('index JSON KB:', (index.length / 1024).toFixed(0))

// 2) light worker: jedi + miniworlds wheel without dependencies; bypass miniworlds/__init__ (which imports pygame)
const light = await loadPyodide()
await light.loadPackage(['micropip', 'jedi'])
light.globals.set('WHEEL', WHEEL)
light.globals.set('INDEX', index)
light.globals.set('SRC', BAD)
await light.runPythonAsync('import micropip; await micropip.install(WHEEL, deps=False)')
console.log(light.runPython(`
import sys, types, json, time, importlib.util, site, os
pkg = next(os.path.join(p, "miniworlds") for p in sys.path if os.path.isdir(os.path.join(p, "miniworlds")))
stub = types.ModuleType("miniworlds"); stub.__path__ = [pkg]; sys.modules["miniworlds"] = stub   # skip __init__ (pygame)
from miniworlds.tools import code_hints, class_model
idx = json.loads(INDEX)
t = time.perf_counter(); hints = code_hints.check({"main.py": SRC}, idx); ms = (time.perf_counter() - t) * 1000
model = class_model.analyze({"main.py": SRC})
f"light worker OK: {len(hints)} hints in {ms:.1f} ms; classes: {[c['name'] for c in model['classes']]}; heap MB {len(bytes(0)) }"
`))
console.log('wasm heap MB (light):', (light._module.HEAPU8.byteLength / 1048576).toFixed(0))

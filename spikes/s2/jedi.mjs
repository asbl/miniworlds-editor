import { loadPyodide } from 'pyodide'
import { COMPLETION_CASES, split, BAD } from './sample.mjs'

const t0 = performance.now()
const py = await loadPyodide()
const tBoot = performance.now() - t0
let t = performance.now()
await py.loadPackage(process.env.LIGHT ? ['micropip', 'jedi'] : ['micropip', 'jedi', 'numpy', 'pygame-ce'])
const tPk = performance.now() - t
const meta = await (await fetch('https://pypi.org/pypi/miniworlds/json')).json()
const wheel = meta.releases[meta.info.version].find((f) => /py3-none-any\.whl$/.test(f.filename)).url
t = performance.now()
py.globals.set('WHEEL', wheel)
await py.runPythonAsync('import micropip; await micropip.install(WHEEL, deps=False) if "${process.env.LIGHT}" else await micropip.install(WHEEL)')
const tMw = performance.now() - t
console.log(`boot ${tBoot.toFixed(0)} ms | jedi+numpy+pygame ${tPk.toFixed(0)} ms | miniworlds ${tMw.toFixed(0)} ms`)
const heap = () => (py._module.HEAPU8.byteLength / 1048576).toFixed(0)
console.log('wasm heap MB after boot+packages:', heap())

py.runPython(`
import jedi, json, time
from jedi.api.environment import InterpreterEnvironment
ENV = InterpreterEnvironment()

def complete(code, line, col):
    t = time.perf_counter()
    s = jedi.Script(code, environment=ENV)
    names = [(c.name, c.type) for c in s.complete(line, col)]
    return json.dumps({"ms": (time.perf_counter() - t) * 1000, "names": names})

def signature(code, line, col):
    t = time.perf_counter()
    s = jedi.Script(code, environment=ENV)
    sigs = [str(x.to_string()) for x in s.get_signatures(line, col)]
    return json.dumps({"ms": (time.perf_counter() - t) * 1000, "sigs": sigs})

def hover(code, line, col):
    t = time.perf_counter()
    s = jedi.Script(code, environment=ENV)
    out = [(n.name, n.type, (n.docstring() or "")[:90]) for n in s.help(line, col)]
    return json.dumps({"ms": (time.perf_counter() - t) * 1000, "help": out})
`)
const complete = py.globals.get('complete')
const signature = py.globals.get('signature')
const hover = py.globals.get('hover')

for (const c of COMPLETION_CASES) {
  const { code, line, column } = split(c.code)
  const cold = JSON.parse(complete(code, line, column))
  const warm = JSON.parse(complete(code, line, column))
  const names = new Set(warm.names.map((n) => n[0]))
  const missing = c.expect.filter((e) => !names.has(e))
  console.log(`${c.name}: ${warm.names.length} Treffer, cold ${cold.ms.toFixed(0)} ms, warm ${warm.ms.toFixed(0)} ms, fehlt: ${missing.length ? missing.join(', ') : '–'}`)
}
// Signature help and hover on self.move(
const sigCode = `import miniworlds as mw\n\nclass K(mw.Actor):\n    def act(self):\n        self.move(`
let r = JSON.parse(signature(sigCode, 5, sigCode.split('\n')[4].length))
console.log('signature self.move(:', r.sigs, r.ms.toFixed(0), 'ms')
const hovCode = `import miniworlds as mw\n\nclass K(mw.Actor):\n    def act(self):\n        self.move(2)\n`
r = JSON.parse(hover(hovCode, 5, 14))
console.log('hover self.move:', JSON.stringify(r.help), r.ms.toFixed(0), 'ms')
// typo case: jedi has no diagnostics; check that it simply returns nothing for the typo
const typo = JSON.parse(complete(`import miniworlds as mw\n\nclass K(mw.Actor):\n    def act(self):\n        self.mov`, 5, 16))
console.log('typo self.mov Vorschläge:', typo.names.slice(0, 5).map((n) => n[0]))
console.log('wasm heap MB at end:', heap())

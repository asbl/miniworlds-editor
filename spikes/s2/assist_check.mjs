// Checks src/language/assist.py in a LIGHT Pyodide (no pygame/numpy) against the real miniworlds wheel.
import { loadPyodide } from 'pyodide'
import { readFileSync } from 'node:fs'
import { COMPLETION_CASES, split, BAD } from './sample.mjs'

const meta = await (await fetch('https://pypi.org/pypi/miniworlds/json')).json()
const WHEEL = meta.releases[meta.info.version].find((f) => /py3-none-any\.whl$/.test(f.filename)).url

// the API index needs the full runtime
const full = await loadPyodide()
await full.loadPackage(['micropip', 'numpy', 'pygame-ce'])
full.globals.set('WHEEL', WHEEL)
await full.runPythonAsync('import micropip; await micropip.install(WHEEL)')
const index = full.runPython('import json\nfrom miniworlds.tools import api_index\njson.dumps(api_index.build_index())')

const py = await loadPyodide()
await py.loadPackage(['micropip', 'jedi'])
py.globals.set('WHEEL', WHEEL)
await py.runPythonAsync('import micropip; await micropip.install(WHEEL, deps=False)')
py.FS.writeFile('/home/pyodide/assist.py', readFileSync(new URL('../../src/language/assist.py', import.meta.url)))
py.runPython('import sys; sys.path.insert(0, "/home/pyodide")\nimport assist')
const assist = py.pyimport('assist')
console.log('setup:', assist.setup())
assist.set_api(index)
const heap = () => (py._module.HEAPU8.byteLength / 1048576).toFixed(0)
console.log('heap MB:', heap())

const files = { 'main.py': BAD, 'classes/Hai.py': 'import miniworlds as mw\n\nclass Hai(mw.Circle):\n    def beissen(self):\n        pass\n' }
assist.sync(JSON.stringify(files))
for (const c of COMPLETION_CASES) {
  const { code, line, column } = split(c.code)
  const t = performance.now()
  const r = JSON.parse(assist.complete('main.py', code, line, column))
  const names = new Set(r.map((x) => x.name))
  const missing = c.expect.filter((e) => !names.has(e))
  console.log(`${c.name}: ${r.length} Treffer, ${(performance.now() - t).toFixed(0)} ms, fehlt: ${missing.join(', ') || '–'}`)
}
// cross-file: class from another file
const cross = 'from classes.Hai import Hai\n\nh = Hai((1, 1))\nh.'
let r = JSON.parse(assist.complete('main.py', cross, 4, 2))
console.log('cross-file h. ->', r.some((x) => x.name === 'beissen') ? 'beissen gefunden' : 'FEHLT', `(${r.length})`)
// subclass of a user class
const sub = 'from classes.Hai import Hai\nimport miniworlds as mw\n\nclass Riesenhai(Hai):\n    def act(self):\n        self.'
r = JSON.parse(assist.complete('main.py', sub, 6, 13))
console.log('user base class members:', ['beissen', 'move'].map((n) => `${n}:${r.some((x) => x.name === n)}`).join(' '))
console.log('hover self.move:', assist.hover('main.py', 'import miniworlds as mw\n\nclass K(mw.Actor):\n    def act(self):\n        self.move(2)\n', 5, 14).slice(0, 160))
const t0 = performance.now()
const hints = JSON.parse(assist.hints(JSON.stringify({ 'main.py': BAD })))
console.log(`hints (${(performance.now() - t0).toFixed(0)} ms):`, hints.map((h) => `${h.line}:${h.code || ''} ${h.message}`))
console.log('heap MB end:', heap())

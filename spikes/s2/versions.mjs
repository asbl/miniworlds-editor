// S5: which miniworlds versions install and import on the current Pyodide? (Node, same V8)
import { loadPyodide } from 'pyodide'

// Node has no window.screen (browsers do); SDL asks for it during display init.
globalThis.screen ??= { width: 1920, height: 1080, availWidth: 1920, availHeight: 1080 }

const meta = await (await fetch('https://pypi.org/pypi/miniworlds/json')).json()
const key = (v) => v.split('.').map(Number)
const cmp = (a, b) => { const x = key(a), y = key(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return d } return 0 }
const withWheel = Object.entries(meta.releases)
  .filter(([, files]) => files.some((f) => f.filename.endsWith('py3-none-any.whl') && !f.yanked))
  .map(([v]) => v).sort(cmp)
console.log('info.version', meta.info.version, '| numeric max with wheel', withWheel.at(-1), '| count', withWheel.length)
console.log('lexicographic last key:', Object.keys(meta.releases).at(-1))

const latestPerMinor = [...new Set(withWheel.map((v) => v.split('.').slice(0, 2).join('.')))]
  .map((m) => withWheel.filter((v) => v.startsWith(m + '.')).at(-1))
const pick = process.argv[2] === '--all' ? withWheel : process.argv[2] === '--minors' ? latestPerMinor : process.argv.slice(2).length ? process.argv.slice(2)
  : [withWheel.at(-1), '4.4.0.9', '4.3.1.8', '4.0.0.0', withWheel[0]].filter((v, i, a) => v && a.indexOf(v) === i)
for (const v of pick) {
  const t = performance.now()
  const py = await loadPyodide()
  await py.loadPackage(['micropip', 'numpy', 'pygame-ce'])
  py.globals.set('SPEC', `miniworlds==${v}`)
  let result
  try {
    await py.runPythonAsync('import micropip; await micropip.install(SPEC)')
    result = py.runPython(`
import importlib.metadata as m
import miniworlds as mw
f"import ok, metadata {m.version('miniworlds')}, Actor={hasattr(mw, 'Actor')}, World={hasattr(mw, 'World')}"
`)
  } catch (e) {
    result = 'FAIL ' + String(e).split('\n').filter(Boolean).slice(-1)[0].slice(0, 140)
  }
  console.log(`${v.padEnd(9)} ${((performance.now() - t) / 1000).toFixed(1)} s  ${result}`)
}

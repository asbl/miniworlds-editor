import { loadPyodide } from 'pyodide'
import { BAD } from './sample.mjs'

const py = await loadPyodide()
await py.loadPackage(['micropip', 'numpy', 'pygame-ce'])
const meta = await (await fetch('https://pypi.org/pypi/miniworlds/json')).json()
py.globals.set('WHEEL', meta.releases[meta.info.version].find((f) => /py3-none-any\.whl$/.test(f.filename)).url)
await py.runPythonAsync('import micropip; await micropip.install(WHEEL)')
py.globals.set('SRC', BAD)
console.log(py.runPython(`
import json, time
from miniworlds.tools import api_index, code_hints
t = time.perf_counter(); idx = api_index.build_index(); t_idx = (time.perf_counter() - t) * 1000
t = time.perf_counter(); first = code_hints.check({"main.py": SRC}, idx); t_first = (time.perf_counter() - t) * 1000
times = []
for _ in range(30):
    t = time.perf_counter(); code_hints.check({"main.py": SRC}, idx); times.append((time.perf_counter() - t) * 1000)
times.sort()
out = [f"api_index build: {t_idx:.0f} ms, size {len(json.dumps(idx))/1024:.0f} KB json",
       f"code_hints first {t_first:.1f} ms, warm p50 {times[15]:.1f} ms, max {times[-1]:.1f} ms", "hints:"]
for h in first:
    out.append(f"  {h['line']}:{h.get('col')} [{h['severity']}] {h['message']}" + (f"  -> {h['replacement']}" if h.get('replacement') else ""))
"\\n".join(out)
`))

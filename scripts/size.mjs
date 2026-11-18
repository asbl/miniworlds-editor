// Prints raw and gzip sizes of everything in dist/.
// Budgets: the shell (loaded before the editor is usable) <= 2 MB gzip (S1). WebAssembly (ruff for lint and format) is
// fetched in the background right after the start by the language worker, not on first use; it is counted separately,
// <= 5 MB gzip, so the first paint is not delayed but the real download after the start is still bounded.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const totals = { shell: { raw: 0, gz: 0 }, lazy: { raw: 0, gz: 0 } }
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) { if (name !== 'pyodide') walk(path); continue } // pyodide/ = scripts/selfhost.mjs, not part of the app
    const buf = readFileSync(path)
    const gz = gzipSync(buf).length
    const kind = name.endsWith('.wasm') ? 'lazy' : 'shell'
    totals[kind].raw += buf.length
    totals[kind].gz += gz
    console.log(`${(buf.length / 1024).toFixed(1).padStart(8)} KB raw ${(gz / 1024).toFixed(1).padStart(8)} KB gzip  ${kind === 'lazy' ? '(background) ' : ''}${path}`)
  }
}
walk('dist')
const line = (label, t) => console.log(`${(t.raw / 1024).toFixed(1).padStart(8)} KB raw ${(t.gz / 1024).toFixed(1).padStart(8)} KB gzip  ${label}`)
line('SHELL', totals.shell)
line('BACKGROUND (wasm)', totals.lazy)
const MB = 1024 * 1024
let failed = false
if (totals.shell.gz > 2 * MB) { console.error('Shell over budget (2 MB gzip)'); failed = true }
if (totals.lazy.gz > 5 * MB) { console.error('Background assets over budget (5 MB gzip)'); failed = true }
if (failed) process.exit(1)

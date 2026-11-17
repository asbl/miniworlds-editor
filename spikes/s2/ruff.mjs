import { Workspace, initLogging } from '@astral-sh/ruff-wasm-nodejs'
import { BAD } from './sample.mjs'

const t0 = performance.now()
const ws = new Workspace(
  { 'line-length': 88, lint: { select: ['E4', 'E7', 'E9', 'F'] } },
  'utf16',
)
console.log('ruff', Workspace.version(), 'init ms', (performance.now() - t0).toFixed(1))
let diags = ws.check(BAD)
console.log('diagnostics:')
for (const d of diags) console.log(`  ${d.start_location.row}:${d.start_location.column} ${d.code} ${d.message}`)
const times = []
for (let i = 0; i < 50; i++) { const s = performance.now(); ws.check(BAD); times.push(performance.now() - s) }
times.sort((a, b) => a - b)
console.log('check ms (50 runs): p50', times[25].toFixed(2), 'max', times[49].toFixed(2))
const bad = 'x=1\nif x==1 :\n  print( "a" )\n'
console.log('format:', JSON.stringify(ws.format(bad)))
const big = BAD.repeat(40)
const s = performance.now(); ws.check(big); console.log(`check ${big.split('\n').length} lines ms`, (performance.now() - s).toFixed(1))

// Self-hosting Pyodide (for schools that block cdn.jsdelivr.net, and for a fully offline-capable deployment).
//   npm run build && node scripts/selfhost.mjs [dist] [--extra=pillow,scipy]
// Downloads Pyodide's core files and the packages the editor loads (plus dependencies) once into .cache/, copies them to
// <dist>/pyodide/v<version>/full/ and points <dist>/config.json at them. Nothing else changes: the same build works with or without.
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const VERSION = '0.29.3' // keep in step with PYODIDE_VERSION in src/runtime/config.ts
const CDN = `https://cdn.jsdelivr.net/pyodide/v${VERSION}/full/`
const CORE = ['pyodide.mjs', 'pyodide.js', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']
// what the runner and the language worker load: src/runtime/worker.ts, src/language/worker.ts
const WANTED = ['micropip', 'numpy', 'pygame-ce', 'jedi']

const args = process.argv.slice(2)
const dist = args.find((a) => !a.startsWith('--')) ?? 'dist'
const extra = (args.find((a) => a.startsWith('--extra='))?.slice(8) ?? '').split(',').filter(Boolean)
const cache = join('.cache', 'pyodide', `v${VERSION}`)

async function download(name) {
  const target = join(cache, name)
  if (existsSync(target)) return target
  const res = await fetch(CDN + name)
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, Buffer.from(await res.arrayBuffer()))
  console.log('downloaded', name)
  return target
}

const lock = JSON.parse(readFileSync(await download('pyodide-lock.json'), 'utf8'))
const closure = new Set()
const visit = (name) => {
  const pkg = lock.packages[name]
  if (!pkg) throw new Error(`Package "${name}" is not in Pyodide ${VERSION}'s lock file`)
  if (closure.has(name)) return
  closure.add(name)
  pkg.depends.forEach(visit)
}
;[...WANTED, ...extra].forEach(visit)

const files = [...CORE, ...[...closure].map((n) => lock.packages[n].file_name)]
const out = join(dist, 'pyodide', `v${VERSION}`, 'full')
mkdirSync(out, { recursive: true })
for (const name of files) {
  const source = await download(name)
  // the lock file lists sha256 sums of the packages: a damaged cache must not end up in a deployment
  const pkg = Object.values(lock.packages).find((p) => p.file_name === name)
  if (pkg?.sha256 && createHash('sha256').update(readFileSync(source)).digest('hex') !== pkg.sha256) throw new Error(`${name}: checksum mismatch (delete .cache/ and retry)`)
  copyFileSync(source, join(out, name))
}

const configPath = join(dist, 'config.json')
const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {}
config.pyodideBase = `./pyodide/v${VERSION}/full/`
writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
console.log(`Pyodide ${VERSION}: ${files.length} files (${[...closure].join(', ')}) -> ${out}; ${configPath} updated`)

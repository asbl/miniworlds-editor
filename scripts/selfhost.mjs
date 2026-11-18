// Self-hosting Pyodide (for schools that block cdn.jsdelivr.net, and for a fully offline-capable deployment).
//   npm run build && node scripts/selfhost.mjs [dist] [--extra=pillow,scipy]
// Downloads Pyodide's core files and the packages the editor loads (plus dependencies) once into .cache/, copies them to
// <dist>/pyodide/v<version>/full/ and points <dist>/config.json at them. Nothing else changes: the same build works with or without.
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// version and package lists come from the source, so they cannot drift apart
const config = readFileSync('src/runtime/config.ts', 'utf8')
const VERSION = /PYODIDE_VERSION = '([^']+)'/.exec(config)?.[1]
const list = (name) => [...(new RegExp(`${name} = \\[([^\\]]*)\\]`).exec(config)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1])
const WANTED = [...new Set([...list('RUNTIME_PACKAGES'), ...list('LANGUAGE_PACKAGES')])]
if (!VERSION || WANTED.length === 0) throw new Error('src/runtime/config.ts: PYODIDE_VERSION or the package lists not found')

const CDN = `https://cdn.jsdelivr.net/pyodide/v${VERSION}/full/`
const CORE = ['pyodide.mjs', 'pyodide.js', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']

const args = process.argv.slice(2)
const dist = args.find((a) => !a.startsWith('--')) ?? 'dist'
const extra = (args.find((a) => a.startsWith('--extra='))?.slice(8) ?? '').split(',').filter(Boolean)
const cache = join('.cache', 'pyodide', `v${VERSION}`)

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

/** A file is only kept when it is complete (size from the server) and, where the lock file knows it, has the right checksum. */
async function download(name, expectedSha) {
  const target = join(cache, name)
  if (existsSync(target)) {
    if (!expectedSha || sha256(target) === expectedSha) return target
    rmSync(target) // damaged copy from an earlier run
  }
  const res = await fetch(CDN + name)
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  const length = Number(res.headers.get('content-length'))
  if (length && length !== bytes.length) throw new Error(`${name}: incomplete download (${bytes.length} of ${length} bytes)`)
  if (bytes.length === 0) throw new Error(`${name}: empty download`)
  if (name.endsWith('.wasm') && bytes.subarray(0, 4).toString('latin1') !== '\0asm') throw new Error(`${name}: not a WebAssembly file`)
  if (expectedSha && createHash('sha256').update(bytes).digest('hex') !== expectedSha) throw new Error(`${name}: checksum mismatch`)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(`${target}.part`, bytes)
  renameSync(`${target}.part`, target) // atomic: an interrupted run never leaves a half file under the real name
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

const packageFiles = [...closure].map((n) => ({ name: lock.packages[n].file_name, sha: lock.packages[n].sha256 }))
const files = [...CORE.map((name) => ({ name })), ...packageFiles]
const out = join(dist, 'pyodide', `v${VERSION}`, 'full')
mkdirSync(out, { recursive: true })
for (const { name, sha } of files) copyFileSync(await download(name, sha), join(out, name))

const configPath = join(dist, 'config.json')
const deployed = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {}
deployed.pyodideBase = `./pyodide/v${VERSION}/full/`
writeFileSync(configPath, JSON.stringify(deployed, null, 2) + '\n')
console.log(`Pyodide ${VERSION}: ${files.length} files (${[...closure].join(', ')}) -> ${out}; ${configPath} updated`)

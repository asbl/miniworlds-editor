import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { Plugin } from 'vite'

/** Writes dist/sw.js from src/pwa/sw.js: the list of all built files to precache and a version derived from their content. */
export function pwaPlugin(): Plugin {
  let outDir = 'dist'
  return {
    name: 'miniworlds-pwa',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
    },
    closeBundle: {
      order: 'post',
      handler() {
        const files: string[] = []
        const walk = (dir: string) => {
          for (const name of readdirSync(dir)) {
            const path = join(dir, name)
            if (statSync(path).isDirectory()) walk(path)
            else files.push(relative(outDir, path).split(sep).join('/'))
          }
        }
        walk(outDir)
        // config.json is deployment-specific (network-first), pyodide/ is added later by scripts/selfhost.mjs, sw.js is this file
        const precache = files.filter((f) => f !== 'sw.js' && f !== 'config.json' && f !== 'config.example.json' && !f.startsWith('pyodide/')).sort()
        const hash = createHash('sha256')
        for (const f of precache) hash.update(f).update(readFileSync(join(outDir, f)))
        const source = readFileSync('src/pwa/sw.js', 'utf8')
          .replace('__VERSION__', hash.digest('hex').slice(0, 12))
          .replace('__PYODIDE__', /PYODIDE_VERSION = '([^']+)'/.exec(readFileSync('src/runtime/config.ts', 'utf8'))?.[1] ?? 'unknown')
          .replace('__PRECACHE__', JSON.stringify(['./', ...precache], null, 1))
        writeFileSync(join(outDir, 'sw.js'), source)
      },
    },
  }
}

// Prints raw and gzip sizes of everything in dist/ (the S1 budget: shell <= 2 MB gzip).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

let rawTotal = 0
let gzTotal = 0
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) { walk(path); continue }
    const buf = readFileSync(path)
    const gz = gzipSync(buf).length
    rawTotal += buf.length
    gzTotal += gz
    console.log(`${(buf.length / 1024).toFixed(1).padStart(8)} KB raw ${(gz / 1024).toFixed(1).padStart(8)} KB gzip  ${path}`)
  }
}
walk('dist')
console.log(`${(rawTotal / 1024).toFixed(1).padStart(8)} KB raw ${(gzTotal / 1024).toFixed(1).padStart(8)} KB gzip  TOTAL`)
const budget = 2 * 1024 * 1024
if (gzTotal > budget) { console.error('Over budget (2 MB gzip)'); process.exit(1) }

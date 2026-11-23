import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
const file = 'dist/compatibility.json'
const data = JSON.parse(await readFile(file, 'utf8'))
data.revision = execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim()
await writeFile(file, JSON.stringify(data, null, 2) + '\n')

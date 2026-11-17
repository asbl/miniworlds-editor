/**
 * Tiny TOML subset for project.toml: `# comments`, `[table]` headers (one level),
 * and `key = value` with string, integer, boolean or array-of-string values.
 * Anything else throws, so a hand-edited file never gets silently misread.
 */
export type TomlValue = string | number | boolean | string[]
export type TomlTable = Record<string, TomlValue>
export interface TomlDoc {
  root: TomlTable
  tables: Record<string, TomlTable>
}

function parseString(raw: string, line: number): string {
  const m = /^"((?:[^"\\]|\\.)*)"$/.exec(raw)
  if (!m) throw new Error(`project.toml, Zeile ${line}: Text muss in Anführungszeichen stehen`)
  return (m[1] as string).replace(/\\(["\\nt])/g, (_, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c))
}

function splitArray(inner: string): string[] {
  const parts: string[] = []
  let cur = ''
  let inStr = false
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i] as string
    if (ch === '"' && inner[i - 1] !== '\\') inStr = !inStr
    if (ch === ',' && !inStr) {
      parts.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur.trim() !== '') parts.push(cur)
  return parts.map((p) => p.trim())
}

function parseValue(raw: string, line: number): TomlValue {
  if (raw.startsWith('"')) return parseString(raw, line)
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (/^-?\d+$/.test(raw)) return Number(raw)
  if (raw.startsWith('[') && raw.endsWith(']')) return splitArray(raw.slice(1, -1)).map((p) => parseString(p, line))
  throw new Error(`project.toml, Zeile ${line}: Wert nicht lesbar: ${raw}`)
}

/** Removes a trailing `# comment` that is not inside a string. */
function stripComment(text: string): string {
  let inStr = false
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"' && text[i - 1] !== '\\') inStr = !inStr
    if (text[i] === '#' && !inStr) return text.slice(0, i)
  }
  return text
}

export function parseToml(text: string): TomlDoc {
  const doc: TomlDoc = { root: {}, tables: {} }
  let target = doc.root
  text.split(/\r?\n/).forEach((rawLine, index) => {
    const line = stripComment(rawLine).trim()
    if (line === '') return
    const header = /^\[([A-Za-z0-9_-]+)\]$/.exec(line)
    if (header) {
      target = doc.tables[header[1] as string] = {}
      return
    }
    const kv = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line)
    if (!kv) throw new Error(`project.toml, Zeile ${index + 1}: nicht lesbar`)
    target[kv[1] as string] = parseValue((kv[2] as string).trim(), index + 1)
  })
  return doc
}

function formatValue(value: TomlValue): string {
  if (Array.isArray(value)) return `[${value.map((v) => formatValue(v)).join(', ')}]`
  if (typeof value === 'string') return `"${value.replace(/[\\"]/g, '\\$&').replace(/\n/g, '\\n').replace(/\t/g, '\\t')}"`
  return String(value)
}

export function stringifyToml(doc: TomlDoc): string {
  const block = (table: TomlTable) => Object.entries(table).map(([k, v]) => `${k} = ${formatValue(v)}\n`).join('')
  let out = block(doc.root)
  for (const [name, table] of Object.entries(doc.tables)) out += `${out ? '\n' : ''}[${name}]\n${block(table)}`
  return out
}

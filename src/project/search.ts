import type { Fs } from '../workspace'

export interface SearchOptions {
  query: string
  caseSensitive: boolean
  regex: boolean
  wholeWord: boolean
}

export interface Hit {
  path: string
  /** 1-based. */
  line: number
  /** 0-based column of the match start within the line. */
  column: number
  length: number
  /** The line's text, trimmed to a readable length. */
  preview: string
}

export const TEXT_EXTENSIONS = new Set(['py', 'toml', 'txt', 'md', 'json', 'csv', 'cfg', 'ini', 'yml', 'yaml', 'html', 'css', 'js'])
export const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'])

export function extensionOf(path: string): string {
  const name = path.split('/').pop() as string
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}
export const isTextPath = (path: string) => TEXT_EXTENSIONS.has(extensionOf(path)) || extensionOf(path) === ''
export const isImagePath = (path: string) => IMAGE_EXTENSIONS.has(extensionOf(path))

export class BadPatternError extends Error {}

/** Builds the global RegExp for the options; `null` for an empty query, throws `BadPatternError` for a bad regex. */
export function compileQuery(options: SearchOptions): RegExp | null {
  if (options.query === '') return null
  let source = options.regex ? options.query : options.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (options.wholeWord) source = `\\b(?:${source})\\b`
  try {
    return new RegExp(source, options.caseSensitive ? 'gu' : 'giu')
  } catch {
    throw new BadPatternError(options.query)
  }
}

export function searchText(path: string, text: string, re: RegExp, limit = Infinity): Hit[] {
  const hits: Hit[] = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length && hits.length < limit; i++) {
    const line = lines[i] as string
    re.lastIndex = 0
    for (let m = re.exec(line); m && hits.length < limit; m = re.exec(line)) {
      if (m[0] === '') {
        re.lastIndex++ // empty regex match: avoid an endless loop
        continue
      }
      hits.push({ path, line: i + 1, column: m.index, length: m[0].length, preview: line.trim().slice(0, 160) })
    }
  }
  return hits
}

/** Plain-text replacement is literal (no `$1`); regex replacement allows `$1`, `$&` like JavaScript. */
export function replaceText(text: string, re: RegExp, replacement: string, literal: boolean): { text: string; count: number } {
  const count = [...text.matchAll(re)].filter((m) => m[0] !== '').length
  if (count === 0) return { text, count: 0 }
  return { text: literal ? text.replace(re, () => replacement) : text.replace(re, replacement), count }
}

export interface ProjectSearchResult {
  hits: Hit[]
  files: number
  truncated: boolean
}

export async function searchProject(fs: Fs, options: SearchOptions, limit = 500): Promise<ProjectSearchResult> {
  const re = compileQuery(options)
  if (!re) return { hits: [], files: 0, truncated: false }
  const hits: Hit[] = []
  const files = new Set<string>()
  for (const entry of await fs.list()) {
    if (entry.kind !== 'file' || !isTextPath(entry.path)) continue
    const found = searchText(entry.path, await fs.read(entry.path), re, limit + 1 - hits.length)
    if (found.length > 0) files.add(entry.path)
    hits.push(...found)
    if (hits.length > limit) break
  }
  const truncated = hits.length > limit
  return { hits: truncated ? hits.slice(0, limit) : hits, files: files.size, truncated }
}

/** Replaces in all text files. `skip` lets the caller exclude files with unsaved edits, returns the changed paths. */
export async function replaceInProject(
  fs: Fs,
  options: SearchOptions,
  replacement: string,
  skip: ReadonlySet<string> = new Set(),
): Promise<{ count: number; changed: string[] }> {
  const re = compileQuery(options)
  if (!re) return { count: 0, changed: [] }
  let count = 0
  const changed: string[] = []
  for (const entry of await fs.list()) {
    if (entry.kind !== 'file' || !isTextPath(entry.path) || skip.has(entry.path)) continue
    const before = await fs.read(entry.path)
    const result = replaceText(before, re, replacement, !options.regex)
    if (result.count === 0) continue
    await fs.write(entry.path, result.text)
    count += result.count
    changed.push(entry.path)
  }
  return { count, changed }
}

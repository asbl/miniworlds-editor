import type { Fs } from './types'
import { normalizePath } from './types'

/** Every file below `dir` (or the file itself), as project-relative paths. */
export async function filesUnder(fs: Fs, path: string): Promise<string[]> {
  const root = normalizePath(path)
  const entries = await fs.list()
  return entries.filter((e) => e.kind === 'file' && (e.path === root || e.path.startsWith(root + '/'))).map((e) => e.path)
}

/** Rename or move a file or a whole folder. Refuses to overwrite anything. */
export async function renamePath(fs: Fs, from: string, to: string): Promise<void> {
  const src = normalizePath(from)
  const dst = normalizePath(to)
  if (src === dst) return
  if (dst.startsWith(src + '/')) throw new Error(`Ziel liegt im Quellordner: ${to}`)
  const files = await filesUnder(fs, src)
  if (files.length === 0) throw new Error(`Nicht gefunden: ${from}`)
  const moves = files.map((file) => [file, dst + file.slice(src.length)] as const)
  for (const [, target] of moves) if (await fs.exists(target)) throw new Error(`Existiert bereits: ${target}`)
  for (const [file, target] of moves) await fs.write(target, await fs.readBytes(file))
  for (const [file] of moves) await fs.remove(file)
}

/** Copy all files of one file system into another (used for "duplicate project" and ZIP import). */
export async function copyAll(from: Fs, to: Fs): Promise<number> {
  const files = (await from.list()).filter((e) => e.kind === 'file')
  for (const { path } of files) await to.write(path, await from.readBytes(path))
  return files.length
}

/** "name.py" → "name 2.py" → "name 3.py" … until the path is free. */
export async function uniquePath(fs: Fs, path: string): Promise<string> {
  if (!(await fs.exists(path))) return path
  const dot = path.lastIndexOf('.')
  const slash = path.lastIndexOf('/')
  const [stem, ext] = dot > slash ? [path.slice(0, dot), path.slice(dot)] : [path, '']
  for (let n = 2; ; n++) {
    const candidate = `${stem} ${n}${ext}`
    if (!(await fs.exists(candidate))) return candidate
  }
}

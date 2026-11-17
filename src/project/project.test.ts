import { describe, expect, it } from 'vitest'
import { MemoryFs, renamePath, uniquePath } from '../workspace'
import { addImport, classNameProblem, classPath, classSource, importLine, removeImport } from './classes'
import { createProject } from './create'
import { detectKind, parseManifest, serializeManifest } from './manifest'
import { compileQuery, BadPatternError, replaceInProject, replaceText, searchProject, searchText } from './search'
import { parseToml, stringifyToml } from './toml'
import { exportZip, importZip, MAX_ZIP_FILES, ZipError } from './zip'
import { zipSync } from 'fflate'

const spec = { kind: 'project', name: 'Demo', miniworlds: '4.4.0.16', worldName: 'Spielfeld', actorName: 'Figur', worldVar: 'welt', actorVar: 'figur' } as const

describe('toml subset', () => {
  it('round-trips strings, numbers, booleans, arrays and tables', () => {
    const doc = { root: { a: 'x "q" \\ y', n: 3, b: true }, tables: { project: { name: 'Demo' }, packages: { requires: ['a', 'b,c'] } } }
    expect(parseToml(stringifyToml(doc))).toEqual(doc)
  })
  it('ignores comments but not # inside strings', () => {
    expect(parseToml('a = "x # y" # note\n# full line\nb = 2').root).toEqual({ a: 'x # y', b: 2 })
  })
  it('rejects what it cannot read', () => {
    expect(() => parseToml('a = 1.5')).toThrow(/Zeile 1/)
    expect(() => parseToml('nonsense')).toThrow(/Zeile 1/)
  })
})

describe('manifest and project kind', () => {
  it('detects the kinds', async () => {
    const fs = new MemoryFs()
    expect(detectKind(await fs.list())).toBe('empty')
    await fs.write('notes.txt', 'x')
    expect(detectKind(await fs.list())).toBe('other')
    await fs.write('main.py', '')
    expect(detectKind(await fs.list())).toBe('legacy')
    await fs.write('project.toml', '')
    expect(detectKind(await fs.list())).toBe('project')
  })
  it('round-trips and defaults', () => {
    const m = { name: 'Demo', miniworlds: '4.4.0.16', entry: 'main.py', packages: ['requests'] }
    expect(parseManifest(serializeManifest(m))).toEqual(m)
    expect(parseManifest('', 'Fallback')).toEqual({ name: 'Fallback', miniworlds: null, entry: 'main.py', packages: [] })
  })
})

describe('createProject', () => {
  it('creates class files and a main.py that imports them', async () => {
    const fs = new MemoryFs()
    await createProject(fs, spec)
    expect((await fs.list()).map((e) => e.path)).toEqual(['classes', 'classes/Figur.py', 'classes/Spielfeld.py', 'main.py', 'project.toml'])
    const main = await fs.read('main.py')
    expect(main).toContain('from classes.Spielfeld import Spielfeld')
    expect(main).toContain('welt.run()')
    expect(parseManifest(await fs.read('project.toml')).miniworlds).toBe('4.4.0.16')
  })
  it('legacy is a single main.py without project.toml', async () => {
    const fs = new MemoryFs()
    await createProject(fs, { ...spec, kind: 'legacy' })
    expect((await fs.list()).map((e) => e.path)).toEqual(['main.py'])
  })
  it('generated sources are valid Python class headers', () => {
    expect(classSource('actor', 'Krabbe')).toContain('class Krabbe(mw.Circle):')
    expect(classSource('world', 'Welt')).toContain('class Welt(mw.World):')
  })
})

describe('class names and imports', () => {
  it('validates names', () => {
    expect(classNameProblem('Krabbe')).toBeNull()
    expect(classNameProblem('_x1')).toBeNull()
    expect(classNameProblem('1abc')).toBe('invalid')
    expect(classNameProblem('my class')).toBe('invalid')
    expect(classNameProblem('class')).toBe('reserved')
    expect(classPath('Krabbe')).toBe('classes/Krabbe.py')
  })
  it('adds the import after the last import, once', () => {
    const src = 'import miniworlds as mw\nfrom classes.A import A\n\nwelt = mw.World()\n'
    const out = addImport(src, 'B')
    expect(out).toBe('import miniworlds as mw\nfrom classes.A import A\nfrom classes.B import B\n\nwelt = mw.World()\n')
    expect(addImport(out, 'B')).toBe(out)
  })
  it('skips docstrings and handles multi-line imports', () => {
    const src = '"""Doc\nstring"""\nfrom x import (\n    a,\n    b,\n)\nprint(1)\n'
    expect(addImport(src, 'C')).toBe('"""Doc\nstring"""\nfrom x import (\n    a,\n    b,\n)\n' + importLine('C') + '\nprint(1)\n')
  })
  it('works without any import', () => {
    expect(addImport('print(1)\n', 'C')).toBe(importLine('C') + '\n\nprint(1)\n')
    expect(addImport('', 'C')).toBe(importLine('C') + '\n')
  })
  it('removes the import again', () => {
    expect(removeImport('import a\nfrom classes.B import B\nx = 1\n', 'B')).toBe('import a\nx = 1\n')
  })
})

describe('search and replace', () => {
  const opts = { query: 'Welt', caseSensitive: false, regex: false, wholeWord: false }
  it('finds hits with line and column, case-insensitively', () => {
    const re = compileQuery(opts) as RegExp
    expect(searchText('a.py', 'x\n  welt = Welt()', re)).toEqual([
      { path: 'a.py', line: 2, column: 2, length: 4, preview: 'welt = Welt()' },
      { path: 'a.py', line: 2, column: 9, length: 4, preview: 'welt = Welt()' },
    ])
  })
  it('honours case, whole word and escapes plain text', () => {
    expect(searchText('a', 'Welt welt Welten', compileQuery({ ...opts, caseSensitive: true }) as RegExp)).toHaveLength(2)
    expect(searchText('a', 'Welt Welten', compileQuery({ ...opts, wholeWord: true }) as RegExp)).toHaveLength(1)
    expect(searchText('a', 'a.b axb', compileQuery({ ...opts, query: 'a.b' }) as RegExp)).toHaveLength(1)
  })
  it('regex mode and bad patterns', () => {
    expect(searchText('a', 'a1 a22', compileQuery({ ...opts, query: 'a\\d+', regex: true }) as RegExp)).toHaveLength(2)
    expect(() => compileQuery({ ...opts, query: '(', regex: true })).toThrow(BadPatternError)
    expect(compileQuery({ ...opts, query: '' })).toBeNull()
  })
  it('literal replacement keeps $ signs, regex replacement expands groups', () => {
    const plain = compileQuery({ ...opts, query: 'a' }) as RegExp
    expect(replaceText('aXa', plain, '$1', true)).toEqual({ text: '$1X$1', count: 2 })
    const rx = compileQuery({ ...opts, query: '(\\d)x', regex: true }) as RegExp
    expect(replaceText('1x 2x', rx, '$1y', false)).toEqual({ text: '1y 2y', count: 2 })
  })
  it('searches and replaces across the project, skips binaries and unsaved files', async () => {
    const fs = new MemoryFs()
    await createProject(fs, spec)
    await fs.write('images/a.png', new Uint8Array([87, 101, 108, 116])) // "Welt" bytes, must not match
    const found = await searchProject(fs, { ...opts, query: 'Spielfeld', caseSensitive: true })
    expect(found.files).toBe(2)
    expect(found.hits.map((h) => h.path)).toEqual(['classes/Spielfeld.py', 'main.py', 'main.py', 'main.py'])
    const done = await replaceInProject(fs, { ...opts, query: 'Spielfeld', caseSensitive: true }, 'Karte', new Set(['main.py']))
    expect(done.changed).toEqual(['classes/Spielfeld.py'])
    expect(await fs.read('main.py')).toContain('Spielfeld')
  })
  it('truncates at the limit', async () => {
    const fs = new MemoryFs()
    await fs.write('a.py', 'x\n'.repeat(10))
    const r = await searchProject(fs, { ...opts, query: 'x' }, 4)
    expect(r.hits).toHaveLength(4)
    expect(r.truncated).toBe(true)
  })
})

describe('zip', () => {
  it('round-trips a project including binary files', async () => {
    const src = new MemoryFs()
    await createProject(src, spec)
    await src.write('images/krabbe.png', new Uint8Array([0, 1, 2, 255]))
    const dst = new MemoryFs()
    expect(await importZip(dst, await exportZip(src))).toBe(5)
    expect(await dst.readBytes('images/krabbe.png')).toEqual(new Uint8Array([0, 1, 2, 255]))
    expect(await dst.read('main.py')).toBe(await src.read('main.py'))
  })
  it('strips a single wrapper folder and junk, as zipped by the OS', async () => {
    const bytes = zipSync({ 'Demo/main.py': new Uint8Array([49]), 'Demo/classes/A.py': new Uint8Array([50]), '__MACOSX/Demo/._main.py': new Uint8Array([0]), 'Demo/.DS_Store': new Uint8Array([0]) })
    const fs = new MemoryFs()
    expect(await importZip(fs, bytes)).toBe(2)
    expect((await fs.list()).map((e) => e.path)).toEqual(['classes', 'classes/A.py', 'main.py'])
  })
  it('rejects path traversal and non-zip data', async () => {
    await expect(importZip(new MemoryFs(), zipSync({ '../evil.py': new Uint8Array([1]) }))).rejects.toThrow('unsafe-path')
    await expect(importZip(new MemoryFs(), new Uint8Array([1, 2, 3]))).rejects.toThrow(ZipError)
  })
  it('enforces the file count limit', async () => {
    const many: Record<string, Uint8Array> = {}
    for (let i = 0; i <= MAX_ZIP_FILES; i++) many[`f${i}.txt`] = new Uint8Array(0)
    await expect(importZip(new MemoryFs(), zipSync(many))).rejects.toThrow('too-many-files')
  })
})

describe('path operations', () => {
  it('renames a folder with its contents and refuses to overwrite', async () => {
    const fs = new MemoryFs()
    await fs.write('a/x.py', '1')
    await fs.write('a/sub/y.py', '2')
    await renamePath(fs, 'a', 'b')
    expect((await fs.list()).filter((e) => e.kind === 'file').map((e) => e.path)).toEqual(['b/sub/y.py', 'b/x.py'])
    await fs.write('c.py', '')
    await expect(renamePath(fs, 'b/x.py', 'c.py')).rejects.toThrow()
    await expect(renamePath(fs, 'b', 'b/inner')).rejects.toThrow()
  })
  it('finds a free name', async () => {
    const fs = new MemoryFs()
    await fs.write('a.py', '')
    await fs.write('a 2.py', '')
    expect(await uniquePath(fs, 'a.py')).toBe('a 3.py')
    expect(await uniquePath(fs, 'free.py')).toBe('free.py')
  })
})

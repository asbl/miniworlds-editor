import { describe, expect, it } from 'vitest'
import { MemoryStore } from '../workspace'
import { importProjectDropped, importProjectFiles } from './projectOps'

const file = (name: string, text: string) => new File([text], name)

describe('importProjectFiles', () => {
  it('one Python file becomes main.py of a project named after it', async () => {
    const store = new MemoryStore()
    const name = await importProjectFiles(store, [file('mein_spiel.py', 'print(1)\n')])
    expect(name).toBe('mein_spiel')
    const { fs } = await store.open('mein_spiel')
    expect(await fs.read('main.py')).toBe('print(1)\n')
    expect((await fs.list()).map((e) => e.path)).toEqual(['main.py'])
  })

  it('several files keep their names, so that imports between them keep working', async () => {
    const store = new MemoryStore()
    await importProjectFiles(store, [file('main.py', 'import helfer\n'), file('helfer.py', 'X = 1\n')])
    const { fs } = await store.open('main')
    expect((await fs.list()).map((e) => e.path).sort()).toEqual(['helfer.py', 'main.py'])
  })

  it('does not rename the single Python file when a main.py comes along with other files', async () => {
    const store = new MemoryStore()
    await importProjectFiles(store, [file('main.py', 'a'), file('bild.png', 'x')])
    const { fs } = await store.open('main')
    expect((await fs.list()).map((e) => e.path).sort()).toEqual(['bild.png', 'main.py'])
  })

  it('never overwrites: a second import of the same file is a second project', async () => {
    const store = new MemoryStore()
    expect(await importProjectFiles(store, [file('spiel.py', 'a')])).toBe('spiel')
    expect(await importProjectFiles(store, [file('spiel.py', 'b')])).toBe('spiel 2')
    expect(await (await store.open('spiel')).fs.read('main.py')).toBe('a')
  })

  it('skips what is not part of a program (editor leftovers) and returns null for nothing', async () => {
    const store = new MemoryStore()
    expect(await importProjectFiles(store, [file('.DS_Store', 'x')])).toBeNull()
    expect(await store.list()).toEqual([])
  })
})

describe('importProjectDropped', () => {
  it('returns null when nothing was dropped', async () => {
    expect(await importProjectDropped(new MemoryStore(), [])).toBeNull()
  })
})

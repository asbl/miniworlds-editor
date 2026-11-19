import { describe, expect, it } from 'vitest'
import { gzipSync } from 'fflate'
import { MemoryFs, MemoryStore } from '../workspace'
import { createShareUrl, importSharedProject, MAX_SHARE_BYTES, MAX_SHARE_FILES, MAX_SHARE_URL } from './share'

function hash(value: unknown): string {
  const bytes = gzipSync(new TextEncoder().encode(JSON.stringify(value)))
  return '#project=v1.' + Buffer.from(bytes).toString('base64url')
}
const file = (path = 'main.py', data = 'print("Hallo")') => ({ path, data: Buffer.from(data).toString('base64url') })

describe('project links', () => {
  it('round trips Unicode, nested files, binary assets and version pins without sending content in the query', async () => {
    const fs = new MemoryFs()
    const binary = new Uint8Array(Array.from({ length: 256 }, (_, i) => i))
    await fs.write('main.py', 'print("Grüße 🦀")\n')
    await fs.write('images/krabbe.png', binary)
    await fs.write('sounds/test.ogg', new Uint8Array([0, 255, 1, 0]))
    await fs.write('project.toml', '[dependencies]\nminiworlds = "3.8.0"')
    await fs.write('__pycache__/main.pyc', 'ignored')
    const url = new URL(await createShareUrl(fs, 'Übung 🦀', 'https://editor.example/app/?zip=secret&embed=1#old'))
    expect(url.origin + url.pathname).toBe('https://editor.example/app/')
    expect(url.search).toBe('')
    const store = new MemoryStore()
    const name = await importSharedProject(store, url.hash)
    expect(name).toBe('Übung 🦀')
    const copy = (await store.open(name)).fs
    expect(await copy.read('main.py')).toBe(await fs.read('main.py'))
    expect(await copy.readBytes('images/krabbe.png')).toEqual(binary)
    expect(await copy.readBytes('sounds/test.ogg')).toEqual(await fs.readBytes('sounds/test.ogg'))
    expect(await copy.read('project.toml')).toBe(await fs.read('project.toml'))
    expect(await copy.exists('__pycache__/main.pyc')).toBe(false)
  })

  it('always makes a fresh copy and leaves existing work untouched', async () => {
    const store = new MemoryStore()
    const original = (await store.open('Aufgabe')).fs
    await original.write('main.py', 'my changes')
    const link = hash({ name: 'Aufgabe', files: [file()] })
    expect(await importSharedProject(store, link)).toBe('Aufgabe 2')
    expect(await importSharedProject(store, link)).toBe('Aufgabe 3')
    expect(await original.read('main.py')).toBe('my changes')
  })

  it.each(['../main.py', '/main.py', 'a/../../main.py', 'a\\b.py', 'a//b.py', './main.py', 'a\u0000.py'])('rejects unsafe paths before creating a project: %s', async (path) => {
    const store = new MemoryStore()
    await expect(importSharedProject(store, hash({ name: 'Task', files: [file(), file(path)] }))).rejects.toMatchObject({ code: 'invalid' })
    expect(await store.list()).toEqual([])
  })

  it('rejects duplicate files and file/directory conflicts before writing', async () => {
    for (const files of [[file(), file()], [file('a'), file('a/b.py')]]) {
      const store = new MemoryStore()
      await expect(importSharedProject(store, hash({ name: 'Task', files }))).rejects.toMatchObject({ code: 'invalid' })
      expect(await store.list()).toEqual([])
    }
  })

  it.each(['#project=v2.abc', '#project=v1.!', '#project=v1.', '#project=v1.A', '#project=v1.abc'])('rejects unknown, corrupt or incomplete links: %s', async (value) => {
    const store = new MemoryStore()
    await expect(importSharedProject(store, value)).rejects.toThrow()
    expect(await store.list()).toEqual([])
  })

  it('rejects missing and corrupt gzip trailers even if the JSON is intact', async () => {
    const packed = Buffer.from(hash({ name: 'Task', files: [file()] }).split('v1.')[1]!, 'base64url')
    for (let removed = 1; removed <= 8; removed++) {
      await expect(importSharedProject(new MemoryStore(), '#project=v1.' + packed.subarray(0, -removed).toString('base64url'))).rejects.toThrow()
    }
    packed[packed.length - 8] = packed[packed.length - 8]! ^ 1
    await expect(importSharedProject(new MemoryStore(), '#project=v1.' + packed.toString('base64url'))).rejects.toMatchObject({ code: 'invalid' })
  })

  it.each([null, {}, { name: '../task', files: [file()] }, { name: 'Task', files: [] }, { name: 'Task', files: [null] }, { name: 'Task', files: [{ path: 'main.py', data: '!' }] }])('rejects invalid project structures', async (value) => {
    const store = new MemoryStore()
    await expect(importSharedProject(store, hash(value))).rejects.toMatchObject({ code: 'invalid' })
    expect(await store.list()).toEqual([])
  })

  it('enforces both the link length and expanded file limits on export', async () => {
    const fs = new MemoryFs()
    await fs.write('main.py', 'x'.repeat(MAX_SHARE_BYTES + 1))
    await expect(createShareUrl(fs, 'Task', 'https://e.org/')).rejects.toMatchObject({ code: 'too-large' })
    // Deterministic poorly compressible data.
    const bytes = new Uint8Array(70_000)
    let state = 12345
    for (let i = 0; i < bytes.length; i++) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; bytes[i] = state & 255 }
    await fs.write('main.py', bytes)
    await expect(createShareUrl(fs, 'Task', 'https://e.org/')).rejects.toMatchObject({ code: 'too-large' })
  })

  it('rejects oversized links, expanded files and decompression bombs on import', async () => {
    const store = new MemoryStore()
    await expect(importSharedProject(store, '#project=v1.' + 'a'.repeat(MAX_SHARE_URL))).rejects.toMatchObject({ code: 'too-large' })
    const large = hash({ name: 'Task', files: [file('main.py', 'x'.repeat(MAX_SHARE_BYTES + 1))] })
    await expect(importSharedProject(store, large)).rejects.toMatchObject({ code: 'too-large' })
    const bomb = hash('x'.repeat(10 * 1024 * 1024))
    expect(bomb.length).toBeLessThan(MAX_SHARE_URL)
    await expect(importSharedProject(store, bomb)).rejects.toMatchObject({ code: 'too-large' })
    expect(await store.list()).toEqual([])
  }, 15_000) // Real multi-megabyte fixtures also run alongside the other CI workers.

  it('enforces file counts on export and import', async () => {
    const fs = new MemoryFs()
    for (let i = 0; i <= MAX_SHARE_FILES; i++) await fs.write(`${i}.py`, '')
    await expect(createShareUrl(fs, 'Task', 'https://e.org/')).rejects.toMatchObject({ code: 'too-many-files' })
    await expect(importSharedProject(new MemoryStore(), hash({ name: 'Task', files: Array.from({ length: MAX_SHARE_FILES + 1 }, (_, i) => file(`${i}.py`)) }))).rejects.toMatchObject({ code: 'too-many-files' })
  })

  it('removes the partial copy when storage fails', async () => {
    const store = new MemoryStore()
    const open = store.open.bind(store)
    store.open = async (name) => {
      const workspace = await open(name)
      workspace.fs.write = async () => { throw new Error('quota exceeded') }
      return workspace
    }
    await expect(importSharedProject(store, hash({ name: 'Task', files: [file()] }))).rejects.toThrow('quota exceeded')
    expect(await store.list()).toEqual([])
  })
})

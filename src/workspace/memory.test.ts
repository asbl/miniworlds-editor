import { describe, expect, it } from 'vitest'
import { MemoryFs } from './memory'
import { normalizePath } from './types'

describe('MemoryFs', () => {
  it('writes, reads and lists with implied directories', async () => {
    const fs = new MemoryFs()
    await fs.write('main.py', 'print(1)')
    await fs.write('classes/Crab.py', 'class Crab: ...')
    expect(await fs.read('classes/Crab.py')).toBe('class Crab: ...')
    expect((await fs.list()).map((e) => `${e.kind}:${e.path}`)).toEqual([
      'dir:classes',
      'file:classes/Crab.py',
      'file:main.py',
    ])
  })

  it('renames, refuses to overwrite and removes directories', async () => {
    const fs = new MemoryFs()
    await fs.write('a.py', 'a')
    await fs.write('b.py', 'b')
    await expect(fs.rename('a.py', 'b.py')).rejects.toThrow()
    await fs.rename('a.py', 'c.py')
    expect(await fs.exists('a.py')).toBe(false)
    await fs.write('d/e.py', 'e')
    await fs.remove('d')
    expect(await fs.exists('d/e.py')).toBe(false)
  })

  it('rejects path traversal', () => {
    expect(() => normalizePath('../x')).toThrow()
    expect(normalizePath('/a//b/./c.py')).toBe('a/b/c.py')
  })
})

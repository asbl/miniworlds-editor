import { describe, expect, it } from 'vitest'
import { MemoryStore, validateProjectName } from './projects'

describe('project store', () => {
  it('lists, opens, removes', async () => {
    const store = new MemoryStore()
    const a = await store.open('Zebra')
    await a.fs.write('main.py', 'x')
    await store.open('Affe')
    expect(await store.list()).toEqual(['Affe', 'Zebra'])
    expect((await (await store.open('Zebra')).fs.read('main.py'))).toBe('x')
    await store.remove('Zebra')
    expect(await store.exists('Zebra')).toBe(false)
  })
  it('validates names', () => {
    expect(validateProjectName('  Mein Projekt ')).toBe('Mein Projekt')
    for (const bad of ['', '  ', '.', '..', 'a/b', 'a\\b', 'a:b', 'x'.repeat(61)]) expect(() => validateProjectName(bad), bad).toThrow('invalid-name')
  })
})

import { describe, expect, it } from 'vitest'
import { packageFiles, prefetchAllowed, prefetchRuntime } from './prefetch'

const lock = {
  packages: {
    micropip: { file_name: 'micropip-0.11.0-py3-none-any.whl', depends: ['packaging'] },
    packaging: { file_name: 'packaging-25.0-py3-none-any.whl', depends: [] },
    numpy: { file_name: 'numpy-2.2.5.whl', depends: [] },
    'pygame-ce': { file_name: 'pygame_ce-2.5.6.whl', depends: ['numpy'] },
    jedi: { file_name: 'jedi.whl', depends: [] },
  },
}

describe('package files', () => {
  it('takes the wanted packages and everything they depend on, once', () => {
    expect(packageFiles(lock, ['micropip', 'numpy', 'pygame-ce']).sort()).toEqual(
      ['micropip-0.11.0-py3-none-any.whl', 'numpy-2.2.5.whl', 'packaging-25.0-py3-none-any.whl', 'pygame_ce-2.5.6.whl'].sort(),
    )
  })
  it('ignores what the lock does not know', () => {
    expect(packageFiles(lock, ['nothing'])).toEqual([])
    expect(packageFiles({}, ['numpy'])).toEqual([])
  })
})

describe('prefetch', () => {
  const answer = (url: string) =>
    url.endsWith('pyodide-lock.json') ? new Response(JSON.stringify(lock)) : new Response('bytes')

  it('asks for the core files and the packages the world worker loads, not for the editor help', async () => {
    const asked: string[] = []
    const fetcher = (async (url: string) => (asked.push(url), answer(url))) as unknown as typeof fetch
    await prefetchRuntime('https://host/py/', fetcher, ['micropip', 'pygame-ce'])
    expect(asked).toContain('https://host/py/pyodide.asm.wasm')
    expect(asked).toContain('https://host/py/python_stdlib.zip')
    expect(asked).toContain('https://host/py/pygame_ce-2.5.6.whl')
    expect(asked).toContain('https://host/py/numpy-2.2.5.whl')
    expect(asked.some((u) => u.includes('jedi'))).toBe(false)
  })
  it('never throws, whatever the network does', async () => {
    const down = (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    await expect(prefetchRuntime('https://host/py/', down)).resolves.toBeUndefined()
    const broken = (async () => new Response('not json')) as unknown as typeof fetch
    await expect(prefetchRuntime('https://host/py/', broken)).resolves.toBeUndefined()
  })
  it('respects the data-saver setting', () => {
    expect(prefetchAllowed({ saveData: true })).toBe(false)
    expect(prefetchAllowed({ saveData: false })).toBe(true)
    expect(prefetchAllowed(undefined)).toBe(true)
  })
})

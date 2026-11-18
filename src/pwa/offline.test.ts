import { describe, expect, it } from 'vitest'
import { cachedVersions, type CacheStorageLike } from './offline'

const storage = (caches: Record<string, string[]>): CacheStorageLike => ({
  keys: async () => Object.keys(caches),
  open: async (name) => ({ keys: async () => (caches[name] ?? []).map((url) => ({ url })) }),
})

describe('cachedVersions', () => {
  it('finds miniworlds wheels in the runtime cache only', async () => {
    const s = storage({
      'mw-runtime-0.29.3': [
        'https://files.pythonhosted.org/packages/ab/cd/miniworlds-4.4.0.16-py3-none-any.whl',
        'https://files.pythonhosted.org/packages/ab/cd/miniworlds-4.4.0.15-py3-none-any.whl',
        'https://files.pythonhosted.org/packages/ab/cd/numpy-2.0-py3-none-any.whl',
        'https://pypi.org/pypi/miniworlds/json',
      ],
      'mw-shell-abc': ['https://x/miniworlds-9.9.9-py3-none-any.whl'],
    })
    expect((await cachedVersions(s)).sort()).toEqual(['4.4.0.15', '4.4.0.16'])
  })
  it('reports nothing without a Cache API or when it fails', async () => {
    expect(await cachedVersions(undefined as unknown as CacheStorageLike)).toEqual([])
    expect(await cachedVersions({ keys: async () => Promise.reject(new Error('denied')), open: async () => Promise.reject(new Error('x')) })).toEqual([])
  })
})

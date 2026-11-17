import { describe, expect, it, vi } from 'vitest'
import type { KeyValue } from '../project/settings'
import { Catalog, toCatalog } from './catalog'
import type { PyPiProject } from './versions'

const file = (name: string) => [{ filename: `miniworlds-${name}-py3-none-any.whl`, url: `https://f/${name}` }]
const project: PyPiProject = {
  info: { version: '4.4.0.16' },
  // PyPI key order is NOT version order (S5)
  releases: { '4.4.0.9': file('4.4.0.9'), '4.4.0.16': file('4.4.0.16'), '4.4.0.14': file('4.4.0.14'), '3.6.0.9': file('3.6.0.9'), '5.0.0rc1': file('5.0.0rc1') },
}
const memory = (): KeyValue => {
  const m = new Map<string, string>()
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) }
}
const okFetch = (body: unknown) => vi.fn(async () => ({ ok: true, json: async () => body }) as Response)

describe('catalog', () => {
  it('builds a newest-first list with tiers and skips unsupported and pre-releases', () => {
    const c = toCatalog(project, 1)
    expect(c.latest).toBe('4.4.0.16')
    expect(c.versions).toEqual([
      { version: '4.4.0.16', tier: 'full' },
      { version: '4.4.0.14', tier: 'basic' },
      { version: '4.4.0.9', tier: 'basic' },
    ])
  })

  it('loads from PyPI, stores the copy and notifies', async () => {
    const store = memory()
    const catalog = new Catalog(store, okFetch(project) as unknown as typeof fetch)
    const seen = vi.fn()
    catalog.subscribe(seen)
    await catalog.load()
    expect(catalog.status).toBe('ready')
    expect(catalog.data?.latest).toBe('4.4.0.16')
    expect(seen).toHaveBeenCalled()
    expect(new Catalog(store, vi.fn(async () => Promise.reject(new Error('offline'))) as unknown as typeof fetch).data?.latest).toBe('4.4.0.16')
  })

  it('keeps the stored copy when offline', async () => {
    const store = memory()
    await new Catalog(store, okFetch(project) as unknown as typeof fetch).load()
    const offline = new Catalog(store, vi.fn(async () => Promise.reject(new Error('offline'))) as unknown as typeof fetch)
    await offline.load()
    expect(offline.status).toBe('offline')
    expect(offline.data?.latest).toBe('4.4.0.16')
    expect(offline.tierOf('4.4.0.14')).toBe('basic')
    expect(offline.tierOf('1.0')).toBeNull()
  })

  it('ignores garbage in storage and empty answers', async () => {
    const store = memory()
    store.set('miniworlds-editor.catalog', '{broken')
    const c = new Catalog(store, okFetch({ info: { version: '1' }, releases: {} }) as unknown as typeof fetch)
    expect(c.data).toBeNull()
    await c.load()
    expect(c.status).toBe('offline')
  })

  it('shares one request between concurrent loads', async () => {
    const f = okFetch(project)
    const c = new Catalog(memory(), f as unknown as typeof fetch)
    await Promise.all([c.load(), c.load()])
    expect(f).toHaveBeenCalledTimes(1)
  })
})

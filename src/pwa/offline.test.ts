import { describe, expect, it } from 'vitest'
import { offlineVersions, rememberInstalled } from './offline'

const memory = () => {
  const m = new Map<string, string>()
  return { get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => void m.set(k, v) }
}

describe('offline versions', () => {
  it('remembers each installed version once', () => {
    const store = memory()
    rememberInstalled(store, '4.4.0.16')
    rememberInstalled(store, '4.4.0.16')
    rememberInstalled(store, '4.4.0.15')
    expect(offlineVersions(store)).toEqual(['4.4.0.16', '4.4.0.15'])
  })
  it('survives damaged storage', () => {
    const store = memory()
    store.set('miniworlds-editor.offlineVersions', '{nope')
    expect(offlineVersions(store)).toEqual([])
    store.set('miniworlds-editor.offlineVersions', '[1,"4.4.0.16"]')
    expect(offlineVersions(store)).toEqual(['4.4.0.16'])
  })
})

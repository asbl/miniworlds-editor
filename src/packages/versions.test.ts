import { describe, expect, it } from 'vitest'
import {
  availableVersions,
  compareVersions,
  engineTier,
  fetchProject,
  latestVersion,
  parseVersion,
  updateStatus,
  type PyPiProject,
} from './versions'

const wheel = (v: string, extra = {}) => [
  { filename: `miniworlds-${v}-py3-none-any.whl`, url: `https://files/${v}.whl`, size: 1, ...extra },
]
// Same ordering quirk as the real PyPI response: "4.4.0.9" is the last key.
const project: PyPiProject = {
  info: { version: '4.4.0.16' },
  releases: {
    '3.6.0.0': wheel('3.6.0.0'),
    '4.0.0.0': wheel('4.0.0.0'),
    '4.4.0.15': wheel('4.4.0.15'),
    '4.4.0.16': wheel('4.4.0.16'),
    '4.4.0.17': wheel('4.4.0.17', { yanked: true }),
    '4.4.0.18rc1': wheel('4.4.0.18rc1'),
    '4.4.0.19': [{ filename: 'miniworlds-4.4.0.19.tar.gz', url: 'https://files/sdist' }],
    '4.4.0.9': wheel('4.4.0.9'),
  },
}

describe('compareVersions', () => {
  it('sorts numerically, not lexicographically', () => {
    expect(compareVersions('4.4.0.16', '4.4.0.9')).toBeGreaterThan(0)
    expect(compareVersions('4.4.0.9', '4.4.0.9')).toBe(0)
    expect(compareVersions('4.4', '4.4.0.0')).toBe(0)
  })
  it('rejects pre-releases', () => {
    expect(parseVersion('4.4.0.18rc1')).toBeNull()
    expect(() => compareVersions('4.4.0.18rc1', '4.4.0.1')).toThrow()
  })
})

describe('availableVersions', () => {
  it('lists newest first and skips yanked, sdist-only, pre-release and unsupported', () => {
    expect(availableVersions(project).map((v) => v.version)).toEqual(['4.4.0.16', '4.4.0.15', '4.4.0.9', '4.0.0.0'])
  })
  it('can include unsupported versions', () => {
    expect(availableVersions(project, true).at(-1)?.version).toBe('3.6.0.0')
  })
  it('picks the latest correctly despite key order', () => {
    expect(latestVersion(project)?.version).toBe('4.4.0.16')
  })
})

describe('engineTier', () => {
  it('maps versions to support levels', () => {
    expect(engineTier('4.4.0.15')).toBe('full')
    expect(engineTier('4.4.0.14')).toBe('basic')
    expect(engineTier('4.0.0.0')).toBe('basic')
    expect(engineTier('3.6.0.9')).toBe('unsupported')
    expect(engineTier('3.6.0.0')).toBe('unsupported')
  })
})

describe('updateStatus', () => {
  it('warns only when a newer version exists', () => {
    expect(updateStatus('4.4.0.9', '4.4.0.16')).toEqual({ kind: 'update-available', latest: '4.4.0.16', tier: 'basic' })
    expect(updateStatus('4.4.0.16', '4.4.0.16')).toEqual({ kind: 'current' })
    expect(updateStatus('4.4.0.17', '4.4.0.16')).toEqual({ kind: 'current' })
  })
  it('stays silent when offline', () => {
    expect(updateStatus('4.4.0.9', null)).toEqual({ kind: 'unknown' })
  })
})

describe('fetchProject', () => {
  it('returns null on network errors and non-OK answers', async () => {
    expect(await fetchProject((async () => { throw new TypeError('offline') }) as typeof fetch)).toBeNull()
    expect(await fetchProject((async () => new Response('', { status: 503 })) as typeof fetch)).toBeNull()
    expect(await fetchProject((async () => Response.json(project)) as typeof fetch)).toEqual(project)
  })
})

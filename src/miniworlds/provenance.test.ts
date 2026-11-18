import { describe, expect, it } from 'vitest'
import { parseProvenance, pruneProvenance, recordSource } from './provenance'

describe('provenance', () => {
  it('reads known sources and drops the rest', () => {
    expect(
      parseProvenance({
        'images/a.png': { source: 'library', id: 'fisch' },
        'images/b.png': { source: 'drawn' },
        'images/c.png': { source: 'upload', shareable: true },
        'images/d.png': { source: 'upload' },
        'images/e.png': { source: 'library' },
        'images/f.png': 'x',
        'images/g.png': { source: 'teleported' },
      }),
    ).toEqual({
      'images/a.png': { source: 'library', id: 'fisch' },
      'images/b.png': { source: 'drawn' },
      'images/c.png': { source: 'upload', shareable: true },
      'images/d.png': { source: 'upload' },
    })
    expect(parseProvenance(null)).toEqual({})
    expect(parseProvenance([1])).toEqual({})
  })
  it('records and prunes', () => {
    const known = recordSource(undefined, 'images/a.png', { source: 'drawn' })
    expect(recordSource(known, 'images/b.png', { source: 'library', id: 'herz' })).toEqual({ 'images/a.png': { source: 'drawn' }, 'images/b.png': { source: 'library', id: 'herz' } })
    expect(pruneProvenance(known, new Set(['images/z.png']))).toEqual({})
    expect(pruneProvenance(undefined, new Set())).toEqual({})
  })
})

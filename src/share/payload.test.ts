import { describe, expect, it } from 'vitest'
import { buildPayload, classifyImages, creditKinds, decodePayload, encodeLink, isPlayHash, materialize, ShareError, type Renderers } from './payload'

const text = (s: string) => new TextEncoder().encode(s)
const ids = new Set(['fisch', 'hai'])
const render: Renderers = { library: async (id) => (ids.has(id) ? text(`LIB:${id}`) : null), placeholder: async () => text('PLACEHOLDER') }

const files = {
  'project.toml': text('name = "Spiel"\n'),
  'main.py': text('print("hi")\n'),
  'classes/Hai.py': text('class Hai: pass\n'),
  'miniworlds.json': text('{"journal": []}'),
  'images/hai.png': text('PNG-LIBRARY'),
  'images/selbst.png': text('PNG-DRAWN'),
  'images/google.png': text('PNG-UPLOAD'),
  'images/unbekannt.jpg': text('PNG-UNKNOWN'),
  '__pycache__/x.pyc': text('junk'),
}
const provenance = {
  'images/hai.png': { source: 'library', id: 'hai' },
  'images/selbst.png': { source: 'drawn' },
  'images/google.png': { source: 'upload' },
} as const

const options = (allowed: string[] = []) => ({ name: 'Mein Spiel', miniworlds: '4.4.0.16', packages: [], files, provenance: { ...provenance }, libraryIds: ids, allowed: new Set(allowed) })

describe('classifyImages', () => {
  it('sorts pictures by where they come from; unknown ones count as uploads', () => {
    const r = classifyImages(Object.keys(files), { ...provenance }, ids)
    expect(r.library).toEqual([{ path: 'images/hai.png', id: 'hai' }])
    expect(r.drawn).toEqual(['images/selbst.png'])
    expect(r.uploads).toEqual(['images/google.png', 'images/unbekannt.jpg'])
  })
  it('does not trust a library claim for an id the editor does not know', () => {
    expect(classifyImages(['images/x.png'], { 'images/x.png': { source: 'library', id: 'gibtsnicht' } }, ids).uploads).toEqual(['images/x.png'])
  })
})

describe('buildPayload', () => {
  it('sends library pictures by name, drawn ones along, and holds back what is not cleared', () => {
    const p = buildPayload(options())
    expect(Object.keys(p.files).sort()).toEqual(['classes/Hai.py', 'images/selbst.png', 'main.py', 'project.toml'])
    expect(p.library).toEqual([{ path: 'images/hai.png', id: 'hai' }])
    expect(p.withheld).toEqual(['images/google.png', 'images/unbekannt.jpg'])
    expect(p.shared).toEqual([])
    expect(JSON.stringify(p)).not.toContain('PNG-UPLOAD')
  })
  it('includes an uploaded picture only when the pupil confirmed it', () => {
    const p = buildPayload(options(['images/google.png']))
    expect(Object.keys(p.files)).toContain('images/google.png')
    expect(p.shared).toEqual(['images/google.png'])
    expect(p.withheld).toEqual(['images/unbekannt.jpg'])
  })
  it('leaves out the editor bookkeeping and junk', () => {
    const p = buildPayload(options())
    expect(Object.keys(p.files).some((f) => f.includes('miniworlds.json') || f.includes('__pycache__'))).toBe(false)
  })
})

describe('link round trip', () => {
  it('encodes a payload into a link and reads it back, files and all', async () => {
    const link = encodeLink(buildPayload(options(['images/google.png'])), 'https://editor.example/')
    expect(link.startsWith('https://editor.example/#play=')).toBe(true)
    expect(isPlayHash(link.slice(link.indexOf('#')))).toBe(true)
    const back = decodePayload(link.slice(link.indexOf('#')))
    expect(back.name).toBe('Mein Spiel')
    expect(back.miniworlds).toBe('4.4.0.16')
    const out = await materialize(back, render)
    expect(new TextDecoder().decode(out['main.py'])).toBe('print("hi")\n')
    expect(new TextDecoder().decode(out['images/hai.png'])).toBe('LIB:hai')
    expect(new TextDecoder().decode(out['images/google.png'])).toBe('PNG-UPLOAD')
    expect(new TextDecoder().decode(out['images/unbekannt.jpg'])).toBe('PLACEHOLDER')
    expect(new TextDecoder().decode(out['images/selbst.png'])).toBe('PNG-DRAWN')
  })
  it('keeps umlauts', async () => {
    const f = { 'main.py': text('print("Grüße — Äpfel")\n') }
    const link = encodeLink(buildPayload({ ...options(), files: f, provenance: {} }), 'x')
    const out = await materialize(decodePayload(link.slice(link.indexOf('#'))), render)
    expect(new TextDecoder().decode(out['main.py'])).toContain('Grüße — Äpfel')
  })
  it('a code-only game makes a short link', () => {
    const link = encodeLink(buildPayload({ ...options(), files: { 'main.py': files['main.py'], 'classes/Hai.py': files['classes/Hai.py'] }, provenance: {} }), 'https://e/')
    expect(link.length).toBeLessThan(400)
  })
  it('reports the picture kinds for the credits', () => {
    expect(creditKinds(buildPayload(options()))).toEqual({ library: true, shared: false, withheld: true })
  })
})

describe('decodePayload refuses what it should', () => {
  const bad = (hash: string) => expect(() => decodePayload(hash)).toThrow(ShareError)
  it('rejects links that are not games or are damaged', () => {
    bad('#nothing')
    bad('#play=!!!')
    bad('#play=' + btoa('not deflate'))
  })
  it('stops unpacking a link that explodes into something huge', async () => {
    const { deflateSync } = await import('fflate')
    const huge = deflateSync(new Uint8Array(60 * 1024 * 1024)) // 60 MB of zeros: a few kilobytes packed
    const hash = '#play=' + btoa(String.fromCharCode(...huge)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(huge.length).toBeLessThan(200_000)
    expect(() => decodePayload(hash)).toThrow(/too large/)
  }, 30_000) // packing 60 MB takes a while when the machine is busy
  it('rejects a payload with a path that climbs out, bad base64, or a newer version', () => {
    const make = (payload: unknown) => encodeLink(payload as never, '').slice(1)
    bad(make({ v: 1, files: { '../evil.py': 'x' } }))
    bad(make({ v: 1, files: { 'a.png': { base64: '***' } } }))
    bad(make({ v: 2, files: {} }))
    bad(make({ v: 1, files: [] }))
  })
  it('ignores bad entries in the picture lists instead of trusting them', () => {
    const make = (payload: unknown) => encodeLink(payload as never, '').slice(1)
    const p = decodePayload(make({ v: 1, files: { 'main.py': 'x' }, library: [{ path: '../x.png', id: 'a' }, { path: 'images/ok.png', id: 'hai' }, { path: 'main.py', id: 'a' }], withheld: ['images/w.png', '../w.png', 'evil.py'] }))
    expect(p.library).toEqual([{ path: 'images/ok.png', id: 'hai' }])
    expect(p.withheld).toEqual(['images/w.png'])
  })
})

import { describe, expect, it } from 'vitest'
import { absoluteBase, loadAppConfig, parseAppConfig } from './appConfig'

const PAGE = 'https://example.org/editor/index.html'

describe('app config', () => {
  it('uses the defaults for anything unusable', () => {
    expect(parseAppConfig(null, PAGE).links).toEqual([])
    expect(parseAppConfig('x', PAGE).embedOrigins).toEqual([]) // embedding is opt-in
    expect(parseAppConfig({ links: 5, embedOrigins: 'x', pyodideBase: 3 }, PAGE).links).toEqual([])
  })
  it('resolves a relative Pyodide base against the page and ends it with a slash', () => {
    expect(parseAppConfig({ pyodideBase: './pyodide/v0.29.3' }, PAGE).pyodideBase).toBe('https://example.org/editor/pyodide/v0.29.3/')
    expect(absoluteBase('https://cdn.example/p/', PAGE)).toBe('https://cdn.example/p/')
  })
  it('accepts only http(s) links and drops the rest', () => {
    const c = parseAppConfig(
      { links: [{ label: 'Java', url: 'https://a.example/?ide=java' }, { label: 'x', url: 'javascript:alert(1)' }, { label: ' ', url: 'https://b.example' }, { url: 'https://c.example' }, { label: 'Rel', url: '../blocks/' }] },
      PAGE,
    )
    expect(c.links).toEqual([
      { label: 'Java', url: 'https://a.example/?ide=java' },
      { label: 'Rel', url: 'https://example.org/blocks/' },
    ])
  })
  it('keeps embed origins as plain origins', () => {
    expect(parseAppConfig({ embedOrigins: ['https://moodle.example/some/path', 'ftp://x', 'nonsense', 4] }, PAGE).embedOrigins).toEqual(['https://moodle.example'])
    expect(parseAppConfig({ embedOrigins: [] }, PAGE).embedOrigins).toEqual([]) // an empty list means: nobody
  })
  it('never turns a damaged embed setting into "every page"', () => {
    expect(parseAppConfig({}, PAGE).embedOrigins).toEqual([])
    expect(parseAppConfig({ embedOrigins: 'https://moodle.example' }, PAGE).embedOrigins).toEqual([]) // a string instead of a list
    expect(parseAppConfig({ embedOrigins: null }, PAGE).embedOrigins).toEqual([])
    expect(parseAppConfig({ embedOrigins: ['*'] }, PAGE).embedOrigins).toBeNull() // only the explicit star opens it
  })
  it('loads the file, and falls back to the defaults when it is missing or broken', async () => {
    const ok = await loadAppConfig(PAGE, async () => new Response(JSON.stringify({ links: [{ label: 'A', url: 'https://a.example' }] })))
    expect(ok.links).toHaveLength(1)
    expect((await loadAppConfig(PAGE, async () => new Response('nope', { status: 404 }))).links).toEqual([])
    expect((await loadAppConfig(PAGE, async () => new Response('{broken'))).links).toEqual([])
    expect((await loadAppConfig(PAGE, async () => Promise.reject(new TypeError('offline')))).links).toEqual([])
    expect((await loadAppConfig(PAGE, async () => Promise.reject(new TypeError('offline')))).embedOrigins).toEqual([]) // a failed fetch denies
  })
})

import { describe, expect, it } from 'vitest'
import { de } from './de'
import { en } from './en'
import { detectLang, t } from './index'

describe('i18n', () => {
  it('both catalogs have exactly the same keys and no empty text', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(de).sort())
    for (const [k, v] of [...Object.entries(de), ...Object.entries(en)]) expect(v, k).not.toBe('')
  })
  it('placeholders match between languages', () => {
    const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    for (const key of Object.keys(de) as (keyof typeof de)[]) expect(names(en[key]), key).toEqual(names(de[key]))
  })
  it('fills placeholders and falls back to the key', () => {
    expect(t('project.importDone', { count: 3 }, 'de')).toBe('3 Dateien importiert.')
    expect(t('project.importDone', { count: 3 }, 'en')).toBe('3 files imported.')
    expect(t('project.importDone', {}, 'en')).toBe('{count} files imported.')
  })
  it('detects the language: stored > browser > German', () => {
    expect(detectLang('en', ['de-DE'])).toBe('en')
    expect(detectLang(null, ['fr-FR', 'en-GB'])).toBe('en')
    expect(detectLang(null, ['fr'])).toBe('de')
    expect(detectLang('xx', [])).toBe('de')
  })
})

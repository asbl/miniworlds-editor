import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES, parsePreferences } from './preferences'

describe('parsePreferences', () => {
  it('starts with the class diagram', () => expect(parsePreferences(null).sidebar).toBe('classes'))
  it('keeps Git off unless explicitly enabled', () => {
    expect(parsePreferences(null).git).not.toBe(true)
    expect(parsePreferences('{"git":"true"}').git).not.toBe(true)
    expect(parsePreferences('{"git":true}').git).toBe(true)
  })
  it('reads a stored choice', () => expect(parsePreferences('{"sidebar":"files"}').sidebar).toBe('files'))
  it('ignores unknown or damaged values', () => {
    expect(parsePreferences('{"sidebar":"search"}')).toEqual(DEFAULT_PREFERENCES)
    expect(parsePreferences('not json')).toEqual(DEFAULT_PREFERENCES)
    expect(parsePreferences('null')).toEqual(DEFAULT_PREFERENCES)
  })
})

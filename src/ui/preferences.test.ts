import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES, parsePreferences } from './preferences'

describe('parsePreferences', () => {
  it('starts with the class diagram', () => expect(parsePreferences(null).sidebar).toBe('classes'))
  it('reads a stored choice', () => expect(parsePreferences('{"sidebar":"files"}').sidebar).toBe('files'))
  it('ignores unknown or damaged values', () => {
    expect(parsePreferences('{"sidebar":"search"}')).toEqual(DEFAULT_PREFERENCES)
    expect(parsePreferences('not json')).toEqual(DEFAULT_PREFERENCES)
    expect(parsePreferences('null')).toEqual(DEFAULT_PREFERENCES)
  })
})

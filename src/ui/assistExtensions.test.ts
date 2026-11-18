import { describe, expect, it } from 'vitest'
import { codePointCol } from './assistExtensions'

describe('codePointCol', () => {
  it('counts code points like jedi, not UTF-16 units', () => {
    expect(codePointCol('abc', 2)).toBe(2)
    expect(codePointCol('😀x', 3)).toBe(2) // the emoji is two UTF-16 units but one code point
    expect(codePointCol('Größe', 5)).toBe(5)
  })
})

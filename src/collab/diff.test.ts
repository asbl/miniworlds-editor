import { describe, expect, it } from 'vitest'
import { simpleDiff } from './diff'

const apply = (s: string, d: ReturnType<typeof simpleDiff>) => s.slice(0, d.index) + d.insert + s.slice(d.index + d.remove)

describe('simpleDiff', () => {
  it('finds the changed middle', () => {
    expect(simpleDiff('hello world', 'hello brave world')).toEqual({ index: 6, remove: 0, insert: 'brave ' })
    expect(simpleDiff('abc', 'abc')).toMatchObject({ remove: 0, insert: '' })
    expect(simpleDiff('', 'x')).toEqual({ index: 0, remove: 0, insert: 'x' })
  })

  it('turns any text into any other text', () => {
    const samples = ['', 'a', 'aaa', 'abab', 'x = 1\ny = 2\n', 'x = 1\ny = 3\n', 'a😀b', 'a😁b', '😀', '😁😀', 'äöü', 'öü']
    for (const a of samples) for (const b of samples) expect(apply(a, simpleDiff(a, b))).toBe(b)
  })
})

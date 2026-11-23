import { describe, expect, it } from 'vitest'
import { parseHoverDoc } from './hoverDoc'

describe('parseHoverDoc', () => {
  it('takes the jedi signature line off the top and dedents the docstring', () => {
    const doc = 'move(distance=1)\n\n    Moves the actor by `distance` pixels.\n\n    Args:\n        distance: how far to move.\n'
    expect(parseHoverDoc(doc)).toEqual({
      signature: 'move(distance=1)',
      summary: 'Moves the actor by `distance` pixels.',
      details: 'Args:\n    distance: how far to move.',
    })
  })

  it('keeps a doc without signature line as summary only', () => {
    expect(parseHoverDoc('Just one line.')).toEqual({ signature: null, summary: 'Just one line.', details: '' })
  })

  it('drops example blocks from the details (long code samples do not belong into a tooltip)', () => {
    const doc = 'switch_origin(value)\n\nSwitch the origin.\n\nArgs:\n    value: "center" or "topleft".\n\nExamples:\n    ::\n\n        self.switch_origin("topleft")\n'
    const parsed = parseHoverDoc(doc)
    expect(parsed.signature).toBe('switch_origin(value)')
    expect(parsed.summary).toBe('Switch the origin.')
    expect(parsed.details).toContain('value: "center" or "topleft".')
    expect(parsed.details).not.toContain('Examples')
    expect(parsed.details).not.toContain('switch_origin("topleft")')
  })

  it('caps long details with an ellipsis', () => {
    const args = 'Args:\n' + Array.from({ length: 40 }, (_, i) => `    param${i}: ${'x'.repeat(30)}`).join('\n')
    const parsed = parseHoverDoc(args)
    expect(parsed.summary).toBe('')
    expect(parsed.details.length).toBeLessThanOrEqual(482)
    expect(parsed.details.endsWith('…')).toBe(true)
  })

  it('treats the first line as signature only when it looks like a call', () => {
    expect(parseHoverDoc('Moves the actor (see below).').signature).toBe(null)
    expect(parseHoverDoc('Actor(width, height)').signature).toBe('Actor(width, height)')
  })
})

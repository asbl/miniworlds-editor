import { describe, expect, it } from 'vitest'
import { build, complete, EVENTS, eventsFor, KEY_CHOICES } from './events'

const event = (id: string) => EVENTS.find((e) => e.id === id)!

describe('events', () => {
  it('has unique ids and every parameter placeholder is covered', () => {
    expect(new Set(EVENTS.map((e) => e.id)).size).toBe(EVENTS.length)
    for (const e of EVENTS) {
      if (/\{key\}/.test(e.code)) expect(e.param).toBe('key')
      if (/\{class\}|\{cls\}/.test(e.code)) expect(e.param).toBe('class')
      if (/\{message\}/.test(e.code)) expect(e.param).toBe('message')
    }
  })

  it('offers actor-only events only to actors', () => {
    expect(eventsFor('world').some((e) => e.id === 'clicked')).toBe(false)
    expect(eventsFor('actor').some((e) => e.id === 'clicked')).toBe(true)
    expect(eventsFor('world').some((e) => e.id === 'worldClick')).toBe(true)
  })

  it('builds the method for a key', () => {
    expect(build(event('keyDown'), { key: 'space' })).toEqual({ method: 'on_key_down_space', code: 'def on_key_down_space(self):\n    ${1:pass}' })
  })

  it('writes the class name in lower case into a sensor event', () => {
    expect(build(event('touchClass'), { className: 'Wand' }).method).toBe('on_detecting_wand')
  })

  it('escapes a message', () => {
    expect(build(event('message'), { message: 'sag "hi"' }).code).toContain('== "sag \\"hi\\""')
  })

  it('knows when a choice is complete', () => {
    expect(complete(event('keyDown'), {})).toBe(false)
    expect(complete(event('keyDown'), { key: 'left' })).toBe(true)
    expect(complete(event('keyDown'), { key: 'ä' })).toBe(false)
    expect(complete(event('touchClass'), { className: 'Wand' })).toBe(true)
    expect(complete(event('touchClass'), { className: 'a b' })).toBe(false)
    expect(complete(event('message'), { message: ' ' })).toBe(false)
    expect(complete(event('act'), {})).toBe(true)
  })

  it('offers only keys the engine has', () => {
    expect(KEY_CHOICES).toContain('space')
    expect(KEY_CHOICES).not.toContain('1')
  })
})

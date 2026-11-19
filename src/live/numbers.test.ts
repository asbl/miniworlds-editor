import { describe, expect, it } from 'vitest'
import { format, fromHex, looksLikeColor, parseNumber, shifted, sliderRange, stepOf, toHex } from './numbers'

describe('parseNumber', () => {
  it('reads plain decimals', () => {
    expect(parseNumber('5')).toEqual({ value: 5, decimals: 0, isFloat: false })
    expect(parseNumber('-3')).toMatchObject({ value: -3, isFloat: false })
    expect(parseNumber('0.25')).toEqual({ value: 0.25, decimals: 2, isFloat: true })
  })
  it('leaves other literals alone', () => {
    for (const text of ['0x1F', '1e3', '1_000', '3j', '', '1.', '.5']) expect(parseNumber(text)).toBeNull()
  })
})

describe('shifted', () => {
  it('moves an integer by whole numbers', () => {
    expect(shifted('5', 3)).toBe('8')
    expect(shifted('5', -8)).toBe('-3')
    expect(shifted('-1', 1)).toBe('0')
  })
  it('moves a decimal by its last digit and keeps the digits', () => {
    expect(shifted('1.5', 1)).toBe('1.6')
    expect(shifted('0.25', 1)).toBe('0.26')
    expect(shifted('1.0', -10)).toBe('0.0')
  })
  it('does not produce -0', () => {
    expect(shifted('1', -1)).toBe('0')
    expect(shifted('0.1', -1)).toBe('0.0')
  })
  it('takes a factor (Shift: ten at a time)', () => {
    expect(shifted('5', 1, 10)).toBe('15')
  })
  it('is null for something that is not a plain number', () => {
    expect(shifted('0xFF', 1)).toBeNull()
  })
})

describe('stepOf and sliderRange', () => {
  it('steps by the last digit', () => {
    expect(stepOf(parseNumber('3')!)).toBe(1)
    expect(stepOf(parseNumber('0.05')!)).toBe(0.01)
  })
  it('centres the slider on the start value with room to move', () => {
    expect(sliderRange(parseNumber('5')!)).toEqual({ min: -5, max: 15, step: 1 })
    expect(sliderRange(parseNumber('200')!)).toEqual({ min: -200, max: 600, step: 1 })
  })
  it('formats like the literal', () => {
    expect(format(2.5, parseNumber('1.00')!)).toBe('2.50')
  })
})

describe('colours', () => {
  it('converts to and from hex', () => {
    expect(toHex([255, 0, 128])).toBe('#ff0080')
    expect(fromHex('#ff0080')).toEqual([255, 0, 128])
    expect(fromHex('red')).toBeNull()
  })
  it('recognises colour arguments', () => {
    expect(looksLikeColor('self.color = ')).toBe(true)
    expect(looksLikeColor('self.add_background(')).toBe(true)
    expect(looksLikeColor('size = ')).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { bootProgress, loadingView } from './loading'

describe('loadingView', () => {
  it('waits while nothing has started', () => {
    expect(loadingView({ phase: 'idle', version: null }, { phase: 'idle' }, false)).toEqual({ status: 'loading', world: 'waiting', help: 'loading' })
  })
  it('shows the world booting', () => {
    expect(loadingView({ phase: 'booting', version: null }, { phase: 'idle' }, true).world).toBe('loading')
  })
  it('stays loading until the editor help is there as well', () => {
    expect(loadingView({ phase: 'ready', version: '4.4.0.16' }, { phase: 'booting' }, true)).toEqual({ status: 'loading', world: 'ready', help: 'loading' })
  })
  it('is done when both are ready', () => {
    expect(loadingView({ phase: 'ready', version: '4.4.0.16' }, { phase: 'ready' }, true).status).toBe('done')
  })
  it('does not wait for a sleeping editor help (low-memory mode)', () => {
    expect(loadingView({ phase: 'ready', version: '4.4.0.16' }, { phase: 'dormant' }, true).status).toBe('done')
  })
  it('a missing editor help does not block', () => {
    expect(loadingView({ phase: 'ready', version: '4.4.0.16' }, { phase: 'error' }, true)).toEqual({ status: 'done', world: 'ready', help: 'failed' })
  })
  it('a world that went back to idle after booting has failed', () => {
    expect(loadingView({ phase: 'idle', version: null }, { phase: 'ready' }, true).status).toBe('failed')
  })
})

describe('bootProgress', () => {
  it('counts the steps 1 to 3 and starts at the first before the worker reports anything', () => {
    expect(bootProgress(null)).toMatchObject({ step: 1, total: 3, what: 'pyodide' })
    expect(bootProgress('packages').step).toBe(2)
    expect(bootProgress('miniworlds').step).toBe(3)
  })
  it('extra packages are part of the last step and the bar only moves forward', () => {
    expect(bootProgress('extra').step).toBe(3)
    const bars = (['pyodide', 'packages', 'miniworlds', 'extra'] as const).map((s) => bootProgress(s).percent)
    expect([...bars].sort((a, b) => a - b)).toEqual(bars)
  })
})

import { describe, expect, it, vi } from 'vitest'
import { engineHintToIssue, jediToItems, mergeIssues, ruffToIssues, translateRuff } from './convert'
import type { FromLanguage, RuffDiagnostic, ToLanguage } from './protocol'
import { LanguageService, type LanguageWorkerLike } from './service'

class FakeWorker implements LanguageWorkerLike {
  sent: ToLanguage[] = []
  terminated = false
  onmessage: LanguageWorkerLike['onmessage'] = null
  onerror: LanguageWorkerLike['onerror'] = null
  postMessage(m: ToLanguage) {
    this.sent.push(m)
  }
  terminate() {
    this.terminated = true
  }
  emit(m: FromLanguage) {
    this.onmessage?.({ data: m })
  }
  reqs() {
    return this.sent.filter((m): m is Extract<ToLanguage, { type: 'req' }> => m.type === 'req')
  }
}

function setup() {
  const workers: FakeWorker[] = []
  const service = new LanguageService({ pyodideBase: 'b/', createWorker: () => (workers.push(new FakeWorker()), workers.at(-1) as FakeWorker) })
  return { service, workers }
}
const tick = () => new Promise((r) => setTimeout(r, 0))

describe('LanguageService', () => {
  it('boots once per engine version and reports readiness', async () => {
    const { service, workers } = setup()
    const first = service.ensure('4.4.0.16')
    expect(service.state.phase).toBe('booting')
    expect(workers[0]?.sent[0]).toMatchObject({ type: 'boot', miniworlds: '4.4.0.16' })
    workers[0]?.emit({ type: 'ready', hints: true, ruff: true, python: true, version: null })
    expect(await first).toBe(true)
    expect(service.state).toEqual({ phase: 'ready', hints: true, ruff: true, python: true })
    await service.ensure('4.4.0.16')
    expect(workers).toHaveLength(1)
  })

  it('restarts for another version and hands the new worker the API index and the files again', async () => {
    const { service, workers } = setup()
    const a = service.ensure('4.4.0.16')
    workers[0]?.emit({ type: 'ready', hints: true, ruff: true, python: true, version: null })
    await a
    service.setApi('{"classes":{}}')
    service.sync({ 'main.py': 'x' })
    const b = service.ensure('4.4.0.15')
    expect(workers[0]?.terminated).toBe(true)
    workers[1]?.emit({ type: 'ready', hints: true, ruff: true, python: true, version: null })
    await b
    expect(workers[1]?.sent.map((m) => m.type)).toEqual(['boot', 'api', 'sync'])
  })

  it('answers requests by id and degrades to empty answers', async () => {
    const { service, workers } = setup()
    const boot = service.ensure(null)
    workers[0]?.emit({ type: 'ready', hints: false, ruff: true, python: true, version: null })
    await boot
    const completion = service.complete('main.py', 'self.', 1, 5)
    await tick()
    const req = workers[0]?.reqs()[0]
    expect(req).toMatchObject({ name: 'complete', args: ['main.py', 'self.', 1, 5] })
    workers[0]?.emit({ type: 'res', id: req?.id as number, ok: true, value: [{ name: 'move', type: 'function', doc: '' }] })
    expect(await completion).toEqual([{ name: 'move', type: 'function', doc: '' }])
    const failing = service.hints({})
    await tick()
    workers[0]?.emit({ type: 'res', id: workers[0]?.reqs()[1]?.id as number, ok: false, error: 'boom' })
    expect(await failing).toEqual([])
  })

  it('without a worker or after a boot error every call is an empty answer', async () => {
    const { service, workers } = setup()
    expect(await service.complete('a.py', '', 1, 0)).toEqual([])
    const boot = service.ensure(null)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    workers[0]?.emit({ type: 'boot-error', text: 'network' })
    expect(await boot).toBe(false)
    warn.mockRestore()
    expect(service.state.phase).toBe('error')
    expect(await service.lint('x')).toEqual([])
    expect(await service.format('x')).toBeNull()
  })

  it('a request that is never answered times out', async () => {
    vi.useFakeTimers()
    const { service, workers } = setup()
    const boot = service.ensure(null)
    workers[0]?.emit({ type: 'ready', hints: true, ruff: true, python: true, version: null })
    await boot
    const result = service.hover('a.py', 'x', 1, 0)
    await vi.advanceTimersByTimeAsync(9000)
    expect(await result).toBeNull()
    vi.useRealTimers()
  })

  it('keeps a "newest" boot that is still running when the world reports a concrete version, and corrects it afterwards', async () => {
    const { service, workers } = setup()
    const first = service.ensure(null)
    void service.ensure('4.4.0.16')
    expect(workers).toHaveLength(1) // no second download on a slow network
    workers[0]?.emit({ type: 'ready', hints: true, ruff: true, python: true, version: '4.4.0.17' })
    await first
    expect(workers).toHaveLength(2) // the world runs another version: now restart for it
    expect(workers[1]?.sent[0]).toMatchObject({ type: 'boot', miniworlds: '4.4.0.16' })
  })

  it('does not restart when the newest version is the one that was asked for', async () => {
    const { service, workers } = setup()
    const first = service.ensure(null)
    void service.ensure('4.4.0.16')
    workers[0]?.emit({ type: 'ready', hints: true, ruff: true, python: true, version: '4.4.0.16' })
    await first
    expect(workers).toHaveLength(1)
  })

  it('keeps ruff when only the Python part is missing and boots again on retry', async () => {
    const { service, workers } = setup()
    const first = service.ensure('4.4.0.16')
    workers[0]?.emit({ type: 'ready', hints: false, ruff: true, python: false, version: null })
    await first
    expect(service.state).toEqual({ phase: 'ready', hints: false, ruff: true, python: false })
    void service.retry()
    expect(workers).toHaveLength(2)
    expect(workers[1]?.sent[0]).toMatchObject({ type: 'boot', miniworlds: '4.4.0.16' })
  })

  it('does not send an unchanged project again', async () => {
    const { service, workers } = setup()
    const first = service.ensure('1')
    workers[0]?.emit({ type: 'ready', hints: true, ruff: true, python: true, version: null })
    await first
    service.sync({ 'main.py': 'a' })
    service.sync({ 'main.py': 'a' })
    service.sync({ 'main.py': 'b' })
    expect(workers[0]?.sent.filter((m) => m.type === 'sync')).toHaveLength(2)
  })

  it('clears request timers when it is discarded', async () => {
    vi.useFakeTimers()
    const { service, workers } = setup()
    const first = service.ensure('1')
    workers[0]?.emit({ type: 'ready', hints: true, ruff: true, python: true, version: null })
    await first
    void service.lint('x')
    await vi.advanceTimersByTimeAsync(0)
    service.dispose()
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })

  it('ignores messages of a replaced worker', async () => {
    const { service, workers } = setup()
    void service.ensure('1')
    const second = service.ensure('2')
    workers[0]?.emit({ type: 'ready', hints: true, ruff: true, python: true, version: null })
    expect(service.state.phase).toBe('booting')
    workers[1]?.emit({ type: 'ready', hints: false, ruff: false, python: true, version: null })
    await second
    expect(service.state.hints).toBe(false)
  })
})

const ruff = (code: string | null, message: string, row: number, c0: number, c1: number, fix: RuffDiagnostic['fix'] = null): RuffDiagnostic => ({
  code, message, start_location: { row, column: c0 }, end_location: { row, column: c1 }, fix,
})

describe('ruff conversion', () => {
  const lines = ['import os', 'from classes.Figur import Figur', 'print(Welt)', 'x = 1']

  it('translates the common rules into German and keeps the rest', () => {
    expect(translateRuff('F821', 'Undefined name `Welt`', 'de')).toBe('Der Name „Welt“ ist nirgends definiert.')
    expect(translateRuff('F401', '`os` imported but unused', 'de')).toBe('„os“ wird importiert, aber nie benutzt.')
    expect(translateRuff('F841', 'Local variable `x` is assigned to but never used', 'de')).toContain('„x“')
    expect(translateRuff('F821', 'Undefined name `Welt`', 'en')).toBe('Undefined name `Welt`')
    expect(translateRuff('W605', 'invalid escape sequence', 'de')).toBe('invalid escape sequence')
    expect(translateRuff(null, 'Expected a parameter', 'de')).toBe('Syntaxfehler: Expected a parameter')
  })

  it('converts 1-based columns, severity and fixes', () => {
    const fix = { message: 'Remove unused import: `os`', edits: [{ content: '', location: { row: 1, column: 1 }, end_location: { row: 2, column: 1 } }] }
    const issues = ruffToIssues([ruff('F401', '`os` imported but unused', 1, 8, 10, fix), ruff('F821', 'Undefined name `Welt`', 3, 7, 11), ruff(null, 'x', 4, 1, 2)], lines, 'de', (l) => `Fix: ${l}`)
    expect(issues[0]).toMatchObject({ line: 1, col: 7, endCol: 9, severity: 'warning', source: 'ruff', code: 'F401', fix: { label: 'Fix: Remove unused import: `os`' } })
    expect(issues[0]?.fix?.edits[0]).toEqual({ line: 1, col: 0, endLine: 2, endCol: 0, text: '' })
    expect(issues[1]).toMatchObject({ severity: 'error', message: 'Der Name „Welt“ ist nirgends definiert.' })
    expect(issues[2]).toMatchObject({ severity: 'error', code: 'invalid-syntax' })
  })

  it('does not nag about `from classes.X import X` (the miniworlds view needs those imports)', () => {
    const issues = ruffToIssues([ruff('F401', '`classes.Figur.Figur` imported but unused', 2, 26, 31)], lines, 'de', String)
    expect(issues).toEqual([])
  })

  it('drops ruff issues that overlap a miniworlds hint on the same spot', () => {
    const engine = [engineHintToIssue({ file: 'm.py', line: 3, col: 6, end_col: 10, severity: 'warning', code: 'undefined-name', message: 'Der Name „Welt“ ist nirgends definiert.', replacement: null }, String)]
    const r = ruffToIssues([ruff('F821', 'Undefined name `Welt`', 3, 7, 11), ruff('F401', '`os` imported but unused', 1, 8, 10)], lines, 'de', String)
    const merged = mergeIssues(engine, r)
    expect(merged.map((i) => `${i.source}:${i.line}`)).toEqual(['ruff:1', 'miniworlds:3'])
  })

  it('turns a hint replacement into a one-edit fix', () => {
    const issue = engineHintToIssue({ file: 'm.py', line: 6, col: 8, end_col: 16, severity: 'warning', code: 'unknown-member', message: 'm', replacement: 'self.move' }, (r) => `Übernehmen: ${r}`)
    expect(issue.fix).toEqual({ label: 'Übernehmen: self.move', edits: [{ line: 6, col: 8, endLine: 6, endCol: 16, text: 'self.move' }] })
  })
})

describe('jedi conversion', () => {
  it('maps types, ranks private names last and marks callables', () => {
    const items = jediToItems([
      { name: 'move', type: 'function', doc: 'Move the actor.' },
      { name: '__init__', type: 'function', doc: '' },
      { name: 'Circle', type: 'class', doc: '' },
      { name: 'x', type: 'property', doc: '' },
      { name: 'distance=', type: 'param', doc: '' },
    ])
    expect(items.map((i) => i.type)).toEqual(['function', 'function', 'class', 'property', 'variable'])
    expect(items[0]).toMatchObject({ call: true, boost: 0, info: 'Move the actor.' })
    expect(items[1]?.boost).toBeLessThan(0)
    expect(items[2]?.call).toBe(false)
    expect(items[4]?.boost).toBeLessThan(items[0]?.boost as number)
    expect(items[2]?.info).toBeUndefined()
  })
})

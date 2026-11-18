import { describe, expect, it } from 'vitest'
import { buildReport } from './report'

const base = {
  time: new Date('2026-11-18T12:00:00Z'),
  lang: 'de',
  userAgent: 'TestBrowser/1',
  engine: '4.4.0.16',
  pinned: null,
  packages: [] as string[],
  files: ['main.py', 'classes/Figur.py'],
  entry: { path: 'main.py', text: 'print(1)\nprint(2)\n' },
  lines: [
    { id: 1, kind: 'system' as const, text: '▶ Programm gestartet' },
    { id: 2, kind: 'stderr' as const, text: 'Traceback…\nNameError: x' },
  ],
}

describe('buildReport', () => {
  it('names versions, files, program and console', () => {
    const text = buildReport(base)
    expect(text).toContain('miniworlds: 4.4.0.16')
    expect(text).toContain('  classes/Figur.py')
    expect(text).toContain('Startdatei main.py:')
    expect(text).toContain('  print(2)')
    expect(text).toContain('[Fehler] Traceback…\nNameError: x')
  })
  it('works without a loaded engine or a start file', () => {
    const text = buildReport({ ...base, engine: null, entry: null, lines: [] })
    expect(text).toContain('nicht geladen')
    expect(text).toContain('Keine Startdatei.')
  })
  it('keeps the report short for big programs and long consoles', () => {
    const lines = Array.from({ length: 200 }, (_, i) => ({ id: i, kind: 'stdout' as const, text: `zeile ${i}` }))
    const text = buildReport({ ...base, entry: { path: 'main.py', text: 'x\n'.repeat(400) }, lines })
    expect(text).toContain('erste 150 Zeilen')
    expect(text).toContain('zeile 199')
    expect(text).not.toContain('zeile 100')
  })
})

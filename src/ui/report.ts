import type { ConsoleLine } from '../runtime/runner'

export interface ReportInput {
  /** When the report was made. */
  time: Date
  lang: string
  userAgent: string
  /** Installed miniworlds version of the running worker (null: Python not loaded). */
  engine: string | null
  /** Version pinned in the project, packages added to it. */
  pinned: string | null
  packages: string[]
  files: string[]
  /** The program's entry file. */
  entry: { path: string; text: string } | null
  lines: readonly ConsoleLine[]
}

const MAX_CODE_LINES = 150
const MAX_CONSOLE_LINES = 60

const label: Record<ConsoleLine['kind'], string> = { stdout: '', stderr: '[Fehler] ', system: '[System] ', input: '[Eingabe] ', hint: '[Tipp] ' }

/** Plain text a pupil can paste into a message: versions, files, the program and what the console said. */
export function buildReport(r: ReportInput): string {
  const code = r.entry ? r.entry.text.split('\n').slice(0, MAX_CODE_LINES) : []
  const out = r.lines.slice(-MAX_CONSOLE_LINES)
  return [
    'miniworlds editor – Bericht',
    `Zeit: ${r.time.toISOString()}`,
    `Sprache: ${r.lang}`,
    `Browser: ${r.userAgent}`,
    `miniworlds: ${r.engine ?? 'nicht geladen'}${r.pinned ? ` (im Projekt festgelegt: ${r.pinned})` : ''}`,
    `Pakete: ${r.packages.length > 0 ? r.packages.join(', ') : '–'}`,
    '',
    `Dateien (${r.files.length}):`,
    ...r.files.slice(0, 80).map((f) => `  ${f}`),
    ...(r.files.length > 80 ? [`  … und ${r.files.length - 80} weitere`] : []),
    '',
    r.entry ? `Startdatei ${r.entry.path}${code.length < r.entry.text.split('\n').length ? ` (erste ${MAX_CODE_LINES} Zeilen)` : ''}:` : 'Keine Startdatei.',
    ...code.map((line) => `  ${line}`),
    '',
    `Konsole (letzte ${out.length} Einträge):`,
    ...out.flatMap((l) => l.text.split('\n').map((line, i) => (i === 0 ? label[l.kind] : '') + line)),
  ].join('\n')
}

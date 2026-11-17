/** Projects live under this directory inside Pyodide; paths in tracebacks are shown relative to it. */
export const PROJECT_ROOT = '/project'

export interface TraceLocation {
  /** Project-relative POSIX path, e.g. "classes/Krabbe.py". */
  path: string
  line: number
}

export type Segment = { text: string; link?: TraceLocation }

const FRAME = /File "([^"]+)", line (\d+)/g

function relative(file: string, root: string): string | null {
  return file.startsWith(root + '/') ? file.slice(root.length + 1) : null
}

/** Splits console text into lines; each `File "/project/…", line N` becomes a link segment. Other files stay plain. */
export function linkify(text: string, root = PROJECT_ROOT): Segment[][] {
  return text.split('\n').map((line) => {
    const segments: Segment[] = []
    let last = 0
    for (const m of line.matchAll(FRAME)) {
      const path = relative(m[1] as string, root)
      if (!path) continue
      const start = m.index as number
      if (start > last) segments.push({ text: line.slice(last, start) })
      segments.push({ text: m[0], link: { path, line: Number(m[2]) } })
      last = start + m[0].length
    }
    if (last < line.length || segments.length === 0) segments.push({ text: line.slice(last) })
    return segments
  })
}

/** The innermost project frame of a traceback: where the pupil's code failed. */
export function errorLocation(text: string, root = PROJECT_ROOT): TraceLocation | null {
  let found: TraceLocation | null = null
  for (const m of text.matchAll(FRAME)) {
    const path = relative(m[1] as string, root)
    if (path) found = { path, line: Number(m[2]) }
  }
  return found
}

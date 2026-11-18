import { useEffect, useRef } from 'preact/hooks'
import { t, useLang } from '../i18n'
import { linkify, type TraceLocation } from '../runtime/traceback'
import type { ConsoleLine } from '../runtime/runner'

/** Program output; `File "/project/x.py", line N` in tracebacks jumps to the code. */
export function Console({
  lines,
  onClear,
  onJump,
  waiting,
  onAnswer,
  onReport,
}: {
  lines: readonly ConsoleLine[]
  onClear: () => void
  onJump: (location: TraceLocation) => void
  /** The program waits in `input()`: show a field for the line. */
  waiting?: { id: string; prompt: string } | null
  onAnswer?: (text: string) => void
  /** Copy a report for the teacher (versions, program, console). */
  onReport?: () => void
}) {
  useLang()
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = box.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [lines, waiting])

  useEffect(() => {
    if (waiting) field.current?.focus()
  }, [waiting?.id])

  return (
    <section class="console" aria-label={t('console.title')}>
      <div class="console-head">
        <span>{t('console.title')}</span>
        <span class="console-actions">
          {onReport && (
            <button type="button" onClick={onReport} title={t('console.reportTitle')}>
              {t('console.report')}
            </button>
          )}
          <button type="button" onClick={onClear} disabled={lines.length === 0}>
            {t('console.clear')}
          </button>
        </span>
      </div>
      <div
        class="console-lines"
        ref={box}
        role="log"
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24 // follow the output unless the user scrolled up
        }}
      >
        {lines.length === 0 && <p class="console-empty">{t('console.empty')}</p>}
        {lines.map((line) => (
          <div key={line.id} class={`line ${line.kind}`}>
            {linkify(line.text).map((segments, row) => (
              <div key={row}>
                {segments.map((seg, i) =>
                  seg.link ? (
                    <button type="button" class="trace-link" key={i} title={t('console.jump')} onClick={() => onJump(seg.link as TraceLocation)}>
                      {seg.text}
                    </button>
                  ) : (
                    <span key={i}>{seg.text}</span>
                  ),
                )}
              </div>
            ))}
          </div>
        ))}
        {waiting && (
          <form
            class="console-input"
            onSubmit={(e) => {
              e.preventDefault()
              const input = field.current
              if (!input) return
              const text = input.value
              input.value = ''
              onAnswer?.(text)
            }}
          >
            <label for="console-field">{waiting.prompt || t('console.input')}</label>
            <input id="console-field" ref={field} type="text" autocomplete="off" autocapitalize="off" spellcheck={false} />
          </form>
        )}
      </div>
    </section>
  )
}

import { useEffect, useRef } from 'preact/hooks'
import { t, useLang } from '../i18n'
import { linkify, type TraceLocation } from '../runtime/traceback'
import type { ConsoleLine } from '../runtime/runner'

/** Program output; `File "/project/x.py", line N` in tracebacks jumps to the code. */
export function Console({ lines, onClear, onJump }: { lines: readonly ConsoleLine[]; onClear: () => void; onJump: (location: TraceLocation) => void }) {
  useLang()
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    const el = box.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [lines])

  return (
    <section class="console" aria-label={t('console.title')}>
      <div class="console-head">
        <span>{t('console.title')}</span>
        <button type="button" onClick={onClear} disabled={lines.length === 0}>
          {t('console.clear')}
        </button>
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
      </div>
    </section>
  )
}

import { t, useLang } from '../i18n'
import type { TraceLocation } from '../runtime/traceback'
import { describeIgnored, isFrameMethod } from './traceStore'
import { GLOW_MS, type TraceView } from './useTrace'

/**
 * "What is the engine doing?": the methods it calls (with counts, glowing when just called) and the inputs nobody
 * answers. A click on a row shows the method in the editor.
 */
export function TracePanel({ trace, running, onJump }: { trace: TraceView; running: boolean; onJump: (location: TraceLocation) => void }) {
  useLang()
  const now = performance.now()
  const rows = trace.store.list()
  const ignored = trace.store.ignored()
  return (
    <details class="trace" open={ignored.length > 0 ? true : undefined}>
      <summary>
        {t('trace.title')}
        <span class="muted"> · {t('trace.count', { n: rows.length })}</span>
        {ignored.length > 0 && (
          <span class="trace-warn" title={t('trace.ignoredTitle')}>
            {' '}
            ⚠ {ignored.length}
          </span>
        )}
      </summary>
      {rows.length === 0 && ignored.length === 0 && <p class="muted small trace-empty">{running ? t('trace.waiting') : t('trace.empty')}</p>}
      {ignored.map((row) => {
        const info = describeIgnored(row)
        const existing = info.existing.join(', ')
        const text =
          info.kind === 'key'
            ? existing
              ? t('trace.ignoredKeyOthers', { key: info.key ?? '', existing, suggestion: `on_key_down_${info.key ?? ''}` })
              : t('trace.ignoredKey', { key: info.key ?? '', suggestion: `on_key_down_${info.key ?? ''}` })
            : t('trace.ignoredClick')
        return (
          <p class="trace-ignored small" key={row.event + existing} role="status">
            <span aria-hidden="true">⚠ </span>
            {text}
            <span class="muted"> ×{row.count}</span>
          </p>
        )
      })}
      {rows.length > 0 && (
        <ul class="trace-list">
          {rows.map((row) => {
            const glowing = !isFrameMethod(row.method) && now - row.lastAt <= GLOW_MS
            return (
              <li key={row.key}>
                <button type="button" class={glowing ? 'trace-row glow' : 'trace-row'} onClick={() => onJump({ path: row.path, line: row.line })} title={t('trace.show')}>
                  <span class="trace-dot" aria-hidden="true" />
                  <span class="trace-name">
                    {row.cls ? `${row.cls}.` : ''}
                    {row.method}
                  </span>
                  <span class="trace-count">×{row.count}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {rows.length > 0 && (
        <button type="button" class="trace-reset small" onClick={trace.clear}>
          {t('trace.reset')}
        </button>
      )}
    </details>
  )
}

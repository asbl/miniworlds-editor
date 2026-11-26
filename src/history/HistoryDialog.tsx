import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { t, useLang } from '../i18n'
import { diffLines, hunks } from './diff'
import { compare, type FileStatus, type Snapshot } from './history'
import { formatDay, formatTime, reasonLabel } from './HistoryPanel'

interface Props {
  snapshot: Snapshot
  /** The snapshot's texts and the project's texts now. */
  old: Record<string, string>
  current: Record<string, string>
  /** Actions that do not apply (e.g. to a version kept on the server) are left out. */
  onRestoreFile?: (path: string) => void
  onRestoreAll?: () => void
  onLabel?: () => void
  onRemove?: () => void
  onClose: () => void
}

const ORDER: Record<FileStatus, number> = { changed: 0, missing: 1, new: 2, same: 3 }

/** One snapshot: which files differ from now, what restoring would change, and the buttons to do it. */
export function HistoryDialog({ snapshot, old, current, onRestoreFile, onRestoreAll, onLabel, onRemove, onClose }: Props) {
  const lang = useLang()
  const ref = useRef<HTMLDialogElement>(null)
  const status = useMemo(() => compare(old, current), [old, current])
  const paths = useMemo(() => Object.keys(status).sort((a, b) => ORDER[status[a] as FileStatus] - ORDER[status[b] as FileStatus] || a.localeCompare(b)), [status])
  const firstChanged = paths.find((p) => status[p] !== 'same') ?? paths[0] ?? null
  const [selected, setSelected] = useState<string | null>(firstChanged)

  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal()
  }, [])

  // What restoring the file would change: the project's text now (old side) becomes the snapshot's (new side).
  const view = useMemo(() => {
    if (!selected) return []
    return hunks(diffLines(current[selected] ?? '', old[selected] ?? ''))
  }, [selected, old, current])
  const differing = paths.filter((p) => status[p] !== 'same').length

  return (
    <dialog ref={ref} class="dialog history-dialog" aria-labelledby="history-title" onCancel={(e) => (e.preventDefault(), onClose())}>
      <div class="dialog-body">
        <h2 id="history-title">
          {formatDay(snapshot.time, lang)}, {formatTime(snapshot.time, lang)} · {reasonLabel(snapshot)}
        </h2>
        <p class="muted small">{differing === 0 ? t('history.identical') : t('history.differs', { n: differing })}</p>
        <div class="history-body">
          <ul class="history-files" aria-label={t('history.fileList')}>
            {paths.map((p) => (
              <li key={p}>
                <button type="button" class={p === selected ? 'history-file selected' : 'history-file'} aria-pressed={p === selected} onClick={() => setSelected(p)}>
                  <span class="history-path">{p}</span>
                  <span class={`history-status ${status[p] as FileStatus}`}>{t(`history.status.${status[p] as FileStatus}` as const)}</span>
                </button>
              </li>
            ))}
          </ul>
          <div class="history-diff" role="region" aria-label={t('history.diff')}>
            {selected && status[selected] !== 'same' && <p class="muted small history-hint">{t('history.diffHint')}</p>}
            {selected && status[selected] === 'same' && <p class="muted">{t('history.noChange')}</p>}
            {view.map((h, i) => (
              <pre key={i} class="hunk">
                {h.lines.map((l, k) => (
                  <div key={k} class={`dl ${l.kind}`}>
                    <span class="dn" aria-hidden="true">
                      {l.newNo ?? l.oldNo ?? ''}
                    </span>
                    <span class="dm" aria-hidden="true">
                      {l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}
                    </span>
                    <span class="dt">{l.text || ' '}</span>
                    <span class="sr-only">{l.kind === 'add' ? t('history.added') : l.kind === 'del' ? t('history.removed') : ''}</span>
                  </div>
                ))}
              </pre>
            ))}
          </div>
        </div>
        <div class="dialog-buttons history-buttons">
          {onLabel && <button type="button" onClick={onLabel}>
            {t('history.rename')}
          </button>}
          {onRemove && <button type="button" onClick={onRemove}>
            {t('history.delete')}
          </button>}
          <span class="spacer" />
          {onRestoreFile && <button type="button" disabled={!selected || status[selected] === 'same' || status[selected] === 'new'} onClick={() => selected && onRestoreFile(selected)}>
            {t('history.restoreFile')}
          </button>}
          {onRestoreAll && <button type="button" class="primary" disabled={differing === 0} onClick={onRestoreAll}>
            {t('history.restoreAll')}
          </button>}
          <button type="button" onClick={onClose}>
            {t('history.close')}
          </button>
        </div>
      </div>
    </dialog>
  )
}

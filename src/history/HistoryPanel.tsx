import { useLang, t } from '../i18n'
import type { Snapshot } from './history'

export const reasonLabel = (s: Snapshot): string => (s.label ? s.label : t(`history.reason.${s.reason}` as const))

export function formatTime(time: number, lang: string): string {
  return new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' }).format(time)
}

export function formatDay(time: number, lang: string, now = Date.now()): string {
  const day = (x: number) => new Date(x).setHours(0, 0, 0, 0)
  const diff = Math.round((day(now) - day(time)) / 86_400_000)
  if (diff === 0) return t('history.today')
  if (diff === 1) return t('history.yesterday')
  return new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short' }).format(time)
}

interface Props {
  snapshots: readonly Snapshot[]
  /** Whether the project can have a history at all (a storage was provided). */
  available: boolean
  onOpen: (snapshot: Snapshot) => void
  onSave: () => void
}

/** The history view: snapshots newest first, grouped by day. */
export function HistoryPanel({ snapshots, available, onOpen, onSave }: Props) {
  const lang = useLang()
  if (!available) return <p class="muted small history-note">{t('history.unavailable')}</p>
  const days: { day: string; items: Snapshot[] }[] = []
  for (const s of snapshots) {
    const day = formatDay(s.time, lang)
    const last = days[days.length - 1]
    if (last && last.day === day) last.items.push(s)
    else days.push({ day, items: [s] })
  }
  return (
    <div class="history">
      <div class="history-tools">
        <button type="button" onClick={onSave}>
          {t('history.save')}
        </button>
      </div>
      {snapshots.length === 0 && <p class="muted small history-note">{t('history.empty')}</p>}
      {days.map(({ day, items }) => (
        <section key={day} aria-label={day}>
          <h2 class="history-day">{day}</h2>
          <ul class="history-list">
            {items.map((s) => (
              <li key={s.id}>
                <button type="button" class="history-row" onClick={() => onOpen(s)}>
                  <span class="history-time">{formatTime(s.time, lang)}</span>
                  <span class={s.label ? 'history-what named' : 'history-what'}>{reasonLabel(s)}</span>
                  <span class="history-size muted small">{t('history.files', { n: Object.keys(s.files).length })}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

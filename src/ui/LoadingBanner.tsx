import { useEffect, useRef, useState } from 'preact/hooks'
import type { LanguageService } from '../language/service'
import type { Runner } from '../runtime/runner'
import { t } from '../i18n'
import { loadingView, type PartStatus } from './loading'
import { useRunnerState } from './hooks'

const DONE_VISIBLE_MS = 2500

const ICON: Record<PartStatus, string> = { waiting: '○', loading: '◌', ready: '✓', failed: '⚠' }

/**
 * Large dismissible card at the bottom while Python, miniworlds and the editor help come up.
 * Makes clear that the editor can already be used, and what only works a little later.
 */
export function LoadingBanner({ runner, language, onReload }: { runner: Runner; language: LanguageService; onReload: () => void }) {
  const runnerState = useRunnerState(runner)
  const [languageState, setLanguageState] = useState(language.state)
  useEffect(() => {
    setLanguageState(language.state)
    return language.subscribe(() => setLanguageState(language.state))
  }, [language])

  const bootSeen = useRef(false)
  if (runnerState.phase === 'booting') bootSeen.current = true
  const view = loadingView(runnerState, languageState, bootSeen.current)

  const [hidden, setHidden] = useState(false)
  // once everything is there: a short "ready" and then away (and it stays away, also for later restarts)
  useEffect(() => {
    if (view.status !== 'done') return
    const timer = setTimeout(() => setHidden(true), DONE_VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [view.status])
  if (hidden) return null

  const worldText =
    view.world === 'ready'
      ? t('loading.world.ready', { version: runnerState.version ?? '' })
      : view.world === 'loading'
        ? t(`run.boot.${runnerState.bootStep ?? 'pyodide'}` as const)
        : view.world === 'failed'
          ? t('loading.world.failed')
          : t('loading.world.waiting')
  const helpText = view.help === 'ready' ? t('loading.help.ready') : view.help === 'failed' ? t('loading.help.failed') : t('loading.help.loading')

  return (
    <section class={`loading-banner ${view.status}`} role="status" aria-live="polite" aria-label={t('loading.title')}>
      <div class="loading-head">
        <h2>{t(`loading.title.${view.status}` as const)}</h2>
        <button type="button" class="loading-close" onClick={() => setHidden(true)} aria-label={t('loading.hide')} title={t('loading.hide')}>
          ✕
        </button>
      </div>
      <p>{t(`loading.text.${view.status}` as const)}</p>
      {view.status !== 'done' && <div class="loading-bar" aria-hidden="true"><span /></div>}
      <ul class="loading-parts">
        <li class={view.world}>
          <span class="loading-icon" aria-hidden="true">{ICON[view.world]}</span>
          <strong>{t('loading.world')}</strong> <span class="muted">– {worldText}</span>
        </li>
        <li class={view.help}>
          <span class="loading-icon" aria-hidden="true">{ICON[view.help]}</span>
          <strong>{t('loading.help')}</strong> <span class="muted">– {helpText}</span>
        </li>
      </ul>
      <div class="loading-actions">
        {view.status === 'failed' && (
          <button type="button" class="primary" onClick={onReload}>
            {t('pwa.reload')}
          </button>
        )}
        <button type="button" onClick={() => setHidden(true)}>
          {t('loading.hide')}
        </button>
      </div>
    </section>
  )
}

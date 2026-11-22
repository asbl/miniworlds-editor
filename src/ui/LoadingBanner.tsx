import { useEffect, useRef, useState } from 'preact/hooks'
import type { LanguageService } from '../language/service'
import type { Runner } from '../runtime/runner'
import { t } from '../i18n'
import { loadingView } from './loading'
import { useRunnerState } from './hooks'

/** Compact start-up status; failure details stay available until dismissed. */
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
  useEffect(() => {
    if (view.status === 'done') setHidden(true)
  }, [view.status])
  if (hidden || view.status === 'done') return null

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
        <span>{view.status === 'failed' ? t('loading.title.failed') : t(view.world === 'ready' ? 'loading.help.loading' : 'loading.compact')}</span>
        <button type="button" class="loading-close" onClick={() => setHidden(true)} aria-label={t('loading.hide')} title={t('loading.hide')}>
          ✕
        </button>
      </div>
      {view.status === 'failed' ? (
        <>
          <p>{t('loading.text.failed')}</p>
          <details>
            <summary>{t('uml.details')}</summary>
            <p>{t('loading.world')}: {worldText}<br />{t('loading.help')}: {helpText}</p>
          </details>
          <div class="loading-actions">
            <button type="button" class="primary" onClick={onReload}>{t('pwa.reload')}</button>
          </div>
        </>
      ) : <small>{t('loading.canEdit')}</small>}
    </section>
  )
}

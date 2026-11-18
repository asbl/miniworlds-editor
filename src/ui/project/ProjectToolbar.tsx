import { useState } from 'preact/hooks'
import { t } from '../../i18n'
import type { Catalog } from '../../packages/catalog'
import { updateStatus } from '../../packages/versions'
import type { ProjectSettings } from '../../project/settings'
import { useCachedVersions } from '../../pwa/offline'
import { useOnline } from '../../pwa/useOnline'
import type { Runner } from '../../runtime/runner'
import type { SyntaxProblem } from '../useAutoReload'
import { Menu, type MenuItem } from '../Menu'
import type { useProgram } from '../useProgram'
import type { Pane } from './layout'

interface Props {
  projectName: string
  runner: Runner
  program: ReturnType<typeof useProgram>
  canRun: boolean
  onRun: () => void
  view: 'program' | 'miniworlds'
  onView: (view: 'program' | 'miniworlds') => void
  miniworldsSupported: boolean
  autoReload: boolean
  onAutoReload: (on: boolean) => void
  settings: ProjectSettings
  versions: Catalog['data']
  catalogStatus: Catalog['status']
  installedVersion: string | null
  onChangeVersion: (version: string | null) => void
  onShowPackages: () => void
  /** A syntax error found while the world reloads itself. */
  reloadProblem: SyntaxProblem | null
  onJump: (location: { path: string; line: number }) => void
  narrow: boolean
  pane: Pane
  onPane: (pane: Pane) => void
  memoryOnly: boolean
}

/** Everything above the three columns: run, mode, version, packages, notices, and the pane tabs on narrow screens. */
export function ProjectToolbar(p: Props) {
  const [dismissedUpdate, setDismissedUpdate] = useState<string | null>(null)
  const { program, settings, versions } = p
  const pinned = settings.miniworlds
  const update = pinned ? updateStatus(pinned, versions?.latest ?? null) : null
  const online = useOnline()
  const noNetwork = !online || p.catalogStatus === 'offline' // the Service Worker may still answer PyPI from its cache
  const offlineNow = useCachedVersions(p.installedVersion, noNetwork)
  const versionItems: MenuItem[] = [
    { label: t('version.newestAuto') + (versions?.latest ? ` (${versions.latest})` : ''), checked: pinned === null, disabled: pinned !== null && noNetwork && !!versions?.latest && !offlineNow.includes(versions.latest), onSelect: () => p.onChangeVersion(null) },
    ...(pinned && !versions?.versions.some((v) => v.version === pinned)
      ? [{ label: pinned, checked: true, divider: true, onSelect: () => p.onChangeVersion(pinned) }]
      : []),
    ...(versions?.versions ?? []).map((v, i) => {
      const unavailable = noNetwork && pinned !== v.version && !offlineNow.includes(v.version)
      const label = v.tier === 'basic' ? `${v.version} · ${t('version.basic')}` : v.version
      return {
        label: unavailable ? `${label} · ${t('version.notOffline')}` : label,
        checked: pinned === v.version,
        divider: i === 0,
        disabled: unavailable,
        onSelect: () => p.onChangeVersion(v.version),
      }
    }),
  ]

  return (
    <section class="project-bar" aria-label={t('a11y.project', { name: p.projectName })}>
      <div class="toolbar" role="toolbar" aria-label={t('run.toolbar')}>
        {program.busy && program.state.phase === 'booting' ? (
          // "Run" was pressed before Python was ready: it starts by itself; stopping now would throw the start-up away
          <button type="button" class="run queued" disabled title={t('run.queued.title')}>
            {t('run.queued')}
          </button>
        ) : program.busy ? (
          <button type="button" class="run stop" onClick={() => void program.stop()} disabled={program.state.phase === 'stopping'} title="Ctrl+Enter">
            ■ {t('run.stop')}
          </button>
        ) : (
          <button type="button" class="run" onClick={p.onRun} disabled={!p.canRun} title="Ctrl+Enter">
            ▶ {t('run.run')}
          </button>
        )}
        <button type="button" onClick={() => p.runner.restart()} title={t('run.restart')} aria-label={t('run.restart')}>
          ↻
        </button>
        <div class="segmented" role="group" aria-label={t('mode.label')}>
          <button type="button" aria-pressed={p.view === 'program'} onClick={() => p.onView('program')}>
            {t('mode.program')}
          </button>
          <button
            type="button"
            aria-pressed={p.view === 'miniworlds'}
            disabled={!p.miniworldsSupported}
            title={p.miniworldsSupported ? undefined : t('mode.needsFull')}
            onClick={() => p.onView('miniworlds')}
          >
            {t('mode.miniworlds')}
          </button>
        </div>
        {p.view === 'miniworlds' && (
          <label class="inline small">
            <input type="checkbox" checked={p.autoReload} onChange={(e) => p.onAutoReload(e.currentTarget.checked)} />
            <span>{t('miniworlds.autoReload')}</span>
          </label>
        )}
        <span class="spacer" />
        <Menu label={`${t('version.label', { version: pinned ?? t('version.newest') })} ▾`} title={t('version.menuTitle')} items={versionItems} align="right" />
        {noNetwork && <span class="muted small">{t('version.offline')}</span>}
        <button type="button" onClick={p.onShowPackages}>
          {t('packages.button')}
          {settings.packages.length > 0 ? ` (${settings.packages.length})` : ''}
        </button>
      </div>
      {update?.kind === 'update-available' && dismissedUpdate !== update.latest && (
        <div class="notice" role="status">
          <span>
            {t('version.updateBanner', { latest: update.latest, current: pinned ?? '' })}
            {update.tier === 'basic' && ` ${t('version.updateFull')}`}
          </span>
          <button type="button" class="primary" onClick={() => p.onChangeVersion(update.latest)}>
            {t('version.update')}
          </button>
          <button type="button" onClick={() => setDismissedUpdate(update.latest)}>
            {t('version.later')}
          </button>
        </div>
      )}
      {p.reloadProblem && p.view === 'miniworlds' && (
        <div class="notice error" role="alert">
          <span>{t('miniworlds.syntaxError', { path: p.reloadProblem.path, line: p.reloadProblem.line, message: p.reloadProblem.message })}</span>
          <button type="button" onClick={() => p.onJump({ path: p.reloadProblem?.path ?? '', line: p.reloadProblem?.line ?? 1 })}>
            {t('console.jump')}
          </button>
        </div>
      )}
      {p.narrow && (
        <div class="pane-tabs" role="tablist" aria-label={t('a11y.panes')}>
          {(['files', 'editor', 'world'] as const).map((id) => (
            <button key={id} type="button" role="tab" aria-selected={p.pane === id} onClick={() => p.onPane(id)}>
              {t(`pane.${id}` as const)}
            </button>
          ))}
        </div>
      )}
      {p.memoryOnly && (
        <div class="banner" role="alert">
          {t('project.memoryWarning')}
        </div>
      )}
    </section>
  )
}

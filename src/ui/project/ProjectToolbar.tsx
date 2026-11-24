import { useEffect, useRef, useState } from 'preact/hooks'
import { t } from '../../i18n'
import type { Catalog } from '../../packages/catalog'
import { updateStatus } from '../../packages/versions'
import type { ProjectSettings } from '../../project/settings'
import { useCachedVersions } from '../../pwa/offline'
import { useOnline } from '../../pwa/useOnline'
import type { Runner } from '../../runtime/runner'
import type { SyntaxProblem } from '../useAutoReload'
import type { MenuItem } from '../Menu'
import type { useProgram } from '../useProgram'
import type { Pane } from './layout'

interface Props {
  pythonSettingsOpen?: boolean
  onClosePythonSettings?: () => void
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
  const pythonDialog = useRef<HTMLDialogElement>(null)
  const [localPythonOpen, setLocalPythonOpen] = useState(false)
  const pythonOpen = p.pythonSettingsOpen ?? localPythonOpen
  const closePython = () => p.onClosePythonSettings ? p.onClosePythonSettings() : setLocalPythonOpen(false)
  useEffect(() => {
    if (pythonOpen && pythonDialog.current && !pythonDialog.current.open) pythonDialog.current.showModal()
  }, [pythonOpen])
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
        <span class="mode-label" aria-hidden="true">{t('mode.label')}:</span>
        <div class="segmented mode-switch" role="group" aria-label={t('mode.label')}>
          <button type="button" aria-pressed={p.view === 'program'} title={t('mode.programHint')} onClick={() => p.onView('program')}>
            <span aria-hidden="true">▶ </span>{t('mode.program')}
          </button>
          <button
            type="button"
            aria-pressed={p.view === 'miniworlds'}
            disabled={!p.miniworldsSupported}
            title={t(p.miniworldsSupported ? 'mode.miniworldsHint' : 'mode.needsFull')}
            onClick={() => p.onView('miniworlds')}
          >
            <span aria-hidden="true">🧪 </span>{t('mode.miniworlds')}
          </button>
        </div>
        {p.view === 'miniworlds' && (
          <label class="inline small">
            <input type="checkbox" checked={p.autoReload} onChange={(e) => p.onAutoReload(e.currentTarget.checked)} />
            <span>{t('miniworlds.autoReload')}</span>
          </label>
        )}
        <span class="spacer" />
        {p.pythonSettingsOpen === undefined && <button type="button" onClick={() => setLocalPythonOpen(true)}>{t('python.menu')}</button>}
      </div>
      {pythonOpen && (
        <dialog ref={pythonDialog} class="dialog python-settings" aria-labelledby="python-title" onCancel={(e) => { e.preventDefault(); closePython() }}>
          <div class="dialog-body">
            <h2 id="python-title">{t('python.settings')}</h2>
            <label class="python-version">
              {t('version.menuTitle')}
              <select value={versionItems.findIndex((item) => item.checked)} onChange={(e) => versionItems[Number(e.currentTarget.value)]?.onSelect()}>
                {versionItems.map((item, i) => <option key={i} value={i} disabled={item.disabled}>{item.label}</option>)}
              </select>
            </label>
            {noNetwork && <p class="muted small">{t('version.offline')}</p>}
            <div class="dialog-buttons">
              <button type="button" onClick={() => { closePython(); p.runner.restart() }}>{t('run.restart')}</button>
              <button type="button" onClick={() => { closePython(); p.onShowPackages() }}>{t('packages.button')}{settings.packages.length ? ` (${settings.packages.length})` : ''}</button>
              <button type="button" class="primary" onClick={closePython}>{t('dialog.close')}</button>
            </div>
          </div>
        </dialog>
      )}
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Workspace, FileEntry } from '../workspace'
import { renamePath, uniquePath } from '../workspace'
import { t, useLang } from '../i18n'
import { addImport, classNameProblem, classPath, classSource, removeImport, CLASS_DIR, type ClassKind } from '../project/classes'
import { detectKind, ENTRY_DEFAULT } from '../project/manifest'
import { isImagePath, isTextPath } from '../project/search'
import type { Catalog } from '../packages/catalog'
import { updateStatus } from '../packages/versions'
import type { Runner } from '../runtime/runner'
import { runtimeConfig, useProgram } from './useProgram'
import { useSettings } from './useSettings'
import { useCatalog } from './hooks'
import { PackagesDialog } from './PackagesDialog'
import { WorldPanel } from './WorldPanel'
import { BinaryViewer } from './ImageViewer'
import { FileTree } from './FileTree'
import { Menu, type MenuItem } from './Menu'
import { SearchPanel } from './SearchPanel'
import { confirmDialog, infoDialog, openDialog } from './dialogs'
import { EditorHost } from './editorHost'
import { Session, type SessionState } from './session'

function useSessionState(session: Session | null): SessionState {
  const [state, setState] = useState<SessionState>(session?.state ?? { open: [], active: null, dirty: new Set() })
  useEffect(() => {
    if (!session) return
    setState(session.state)
    return session.subscribe(() => setState(session.state))
  }, [session])
  return state
}

interface Props {
  workspace: Workspace
  projectName: string
  runner: Runner
  catalog: Catalog
  /** The parent calls this to flush unsaved edits before export, switching projects, etc. */
  registerFlush: (flush: (() => Promise<void>) | null) => void
}

export function ProjectView({ workspace, projectName, runner, catalog, registerFlush }: Props) {
  const lang = useLang()
  const { fs } = workspace
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [session, setSession] = useState<Session | null>(null)
  const [tab, setTab] = useState<'files' | 'search'>('files')
  const [searchSignal, setSearchSignal] = useState(0)
  const [dragging, setDragging] = useState(false)
  const mount = useRef<HTMLDivElement>(null)
  const host = useRef<EditorHost | null>(null)
  const upload = useRef<HTMLInputElement>(null)
  const state = useSessionState(session)
  const kind = detectKind(entries)
  const [showPackages, setShowPackages] = useState(false)
  const [dismissedUpdate, setDismissedUpdate] = useState<string | null>(null)

  const refresh = useCallback(async () => setEntries(await fs.list()), [fs])
  const { settings, loaded: settingsLoaded, update: updateSettings } = useSettings(fs, kind, projectName, session)
  const { data: versions, status: catalogStatus } = useCatalog(catalog)
  const program = useProgram({ runner, catalog, fs, session, host, settings, settingsLoaded, refresh })

  // Editor + session lifecycle (one per project).
  useEffect(() => {
    let sess: Session | null = null
    const editor = new EditorHost(mount.current as HTMLElement, (path, text) => sess?.edit(path, text), lang)
    host.current = editor
    sess = new Session(fs, editor)
    setSession(sess)
    registerFlush(() => (sess as Session).saveAll())
    void (async () => {
      await refresh()
      const list = await fs.list()
      const first = list.find((e) => e.path === ENTRY_DEFAULT) ?? list.find((e) => e.kind === 'file')
      if (first) await sess.open(first.path)
    })()
    const flush = () => void sess?.saveAll()
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      registerFlush(null)
      void sess?.saveAll().finally(() => sess?.dispose())
      editor.destroy()
      host.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fs])

  useEffect(() => host.current?.setLang(lang), [lang])

  const report = (error: unknown) =>
    infoDialog(t('dialog.error'), error instanceof Error ? error.message : String(error))

  // ---- file operations ----
  async function newFile(prefill = '') {
    const values = await openDialog({
      title: t('files.newFile'),
      fields: [{ kind: 'text', key: 'path', label: t('files.path'), initial: prefill }],
      submit: 'dialog.create',
      validate: async (v) => {
        const path = String(v.path).trim().replace(/^\/+/, '')
        if (path === '' || path.split('/').includes('..') || path.endsWith('/')) return t('project.invalidName')
        return (await fs.exists(path)) ? t('files.exists', { path }) : null
      },
    })
    if (!values) return
    const path = String(values.path).trim().replace(/^\/+/, '')
    try {
      await fs.write(path, '')
      await refresh()
      await session?.open(path)
    } catch (error) {
      await report(error)
    }
  }

  async function newClass() {
    if (kind !== 'project') return void (await infoDialog(t('class.title'), t('class.onlyInProject')))
    const hasMain = await fs.exists(ENTRY_DEFAULT)
    const values = await openDialog({
      title: t('class.title'),
      fields: [
        { kind: 'text', key: 'name', label: t('class.name') },
        {
          kind: 'select',
          key: 'kind',
          label: t('class.kind'),
          initial: 'actor',
          options: [
            { value: 'actor', label: t('class.kind.actor') },
            { value: 'world', label: t('class.kind.world') },
            { value: 'plain', label: t('class.kind.plain') },
          ],
        },
        ...(hasMain ? [{ kind: 'checkbox' as const, key: 'import', label: t('class.addImport'), initial: true }] : []),
      ],
      submit: 'dialog.create',
      validate: async (v) => {
        const name = String(v.name).trim()
        const problem = classNameProblem(name)
        if (problem === 'invalid') return t('class.invalid')
        if (problem === 'reserved') return t('class.reserved', { name })
        return (await fs.exists(classPath(name))) ? t('files.exists', { path: classPath(name) }) : null
      },
    })
    if (!values) return
    const name = String(values.name).trim()
    try {
      await fs.write(classPath(name), classSource(values.kind as ClassKind, name))
      if (values.import && hasMain) await session?.writeText(ENTRY_DEFAULT, addImport(await (session as Session).readText(ENTRY_DEFAULT), name))
      await refresh()
      await session?.open(classPath(name))
    } catch (error) {
      await report(error)
    }
  }

  async function addFiles(files: FileList | File[]) {
    try {
      let last: string | null = null
      for (const file of Array.from(files)) {
        const folder = isImagePath(file.name) ? 'images/' : ''
        last = await uniquePath(fs, folder + file.name)
        await fs.write(last, new Uint8Array(await file.arrayBuffer()))
      }
      await refresh()
      if (last) await session?.open(last)
    } catch (error) {
      await report(error)
    }
  }

  async function renameEntry(path: string) {
    const isDir = entries.find((e) => e.path === path)?.kind === 'dir'
    const values = await openDialog({
      title: t('files.rename'),
      message: t('files.renameTo', { path }),
      fields: [{ kind: 'text', key: 'to', label: t('files.path'), initial: path }],
      validate: async (v) => {
        const to = String(v.to).trim().replace(/^\/+/, '')
        if (to === '' || to.split('/').includes('..')) return t('project.invalidName')
        if (to === path) return null
        const clash = isDir ? entries.some((e) => e.path === to || e.path.startsWith(to + '/')) : await fs.exists(to)
        return clash ? t('files.exists', { path: to }) : null
      },
    })
    if (!values) return
    const to = String(values.to).trim().replace(/^\/+/, '')
    if (to === path) return
    try {
      await session?.saveAll()
      await renamePath(fs, path, to)
      await session?.moved(path, to)
      await refresh()
    } catch (error) {
      await report(error)
    }
  }

  async function deleteEntry(path: string) {
    if (!(await confirmDialog(t('files.delete'), t('files.deleteConfirm', { path })))) return
    try {
      await fs.remove(path)
      await session?.removed(path)
      // a deleted class file would leave a dangling import in main.py
      const m = new RegExp(`^${CLASS_DIR}/([A-Za-z_][A-Za-z0-9_]*)\\.py$`).exec(path)
      if (m && kind === 'project' && session && (await fs.exists(ENTRY_DEFAULT))) {
        const main = await session.readText(ENTRY_DEFAULT)
        const cleaned = removeImport(main, m[1] as string)
        if (cleaned !== main) await session.writeText(ENTRY_DEFAULT, cleaned)
      }
      await refresh()
    } catch (error) {
      await report(error)
    }
  }

  function openSearch() {
    setTab('search')
    setSearchSignal((n) => n + 1)
  }

  function onKeyDown(event: KeyboardEvent) {
    const mod = event.ctrlKey || event.metaKey
    if (mod && event.key === 'Enter') {
      event.preventDefault()
      void (program.busy ? program.stop() : program.run())
    } else if (mod && event.key.toLowerCase() === 's') {
      event.preventDefault()
      if (state.active) void session?.save(state.active)
    } else if (mod && event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      openSearch()
    }
  }

  async function changeVersion(version: string | null) {
    await program.stop()
    await updateSettings({ miniworlds: version })
  }

  const pinned = settings.miniworlds
  const update = pinned ? updateStatus(pinned, versions?.latest ?? null) : null
  const versionItems: MenuItem[] = [
    { label: t('version.newestAuto') + (versions?.latest ? ` (${versions.latest})` : ''), checked: pinned === null, onSelect: () => void changeVersion(null) },
    ...(pinned && !versions?.versions.some((v) => v.version === pinned)
      ? [{ label: pinned, checked: true, divider: true, onSelect: () => void changeVersion(pinned) }]
      : []),
    ...(versions?.versions ?? []).map((v, i) => ({
      label: v.tier === 'basic' ? `${v.version} · ${t('version.basic')}` : v.version,
      checked: pinned === v.version,
      divider: i === 0,
      onSelect: () => void changeVersion(v.version),
    })),
  ]

  const active = state.active
  const showBinary = active !== null && !isTextPath(active)
  const memoryOnly = workspace.kind === 'memory'

  const addMenu = useMemo<MenuItem[]>(
    () => [
      { label: t('files.newFile'), onSelect: () => void newFile() },
      { label: t('files.newClass'), onSelect: () => void newClass(), disabled: kind !== 'project' },
      { label: t('files.upload'), onSelect: () => upload.current?.click(), divider: true },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lang, kind, session, entries],
  )

  return (
    <div
      class={dragging ? 'project dragging' : 'project'}
      onKeyDown={onKeyDown}
      onDragOver={(e) => {
        if (e.dataTransfer?.types.includes('Files')) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false)
      }}
      onDrop={(e) => {
        setDragging(false)
        if (e.dataTransfer?.files.length) {
          e.preventDefault()
          void addFiles(e.dataTransfer.files)
        }
      }}
    >
      <div class="toolbar" role="toolbar" aria-label={t('run.toolbar')}>
        {program.busy ? (
          <button type="button" class="run stop" onClick={() => void program.stop()} disabled={program.state.phase === 'stopping'} title="Ctrl+Enter">
            ■ {t('run.stop')}
          </button>
        ) : (
          <button type="button" class="run" onClick={() => void program.run()} disabled={!session} title="Ctrl+Enter">
            ▶ {t('run.run')}
          </button>
        )}
        <button type="button" onClick={() => runner.restart()} title={t('run.restart')} aria-label={t('run.restart')}>
          ↻
        </button>
        <span class="spacer" />
        <Menu
          label={`${t('version.label', { version: pinned ?? t('version.newest') })} ▾`}
          title={t('version.menuTitle')}
          items={versionItems}
          align="right"
        />
        {catalogStatus === 'offline' && <span class="muted small">{t('version.offline')}</span>}
        <button type="button" onClick={() => setShowPackages(true)}>
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
          <button type="button" class="primary" onClick={() => void changeVersion(update.latest)}>
            {t('version.update')}
          </button>
          <button type="button" onClick={() => setDismissedUpdate(update.latest)}>
            {t('version.later')}
          </button>
        </div>
      )}
      <div class="body">
      <aside class="sidebar">
        <div class="sidebar-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'files'} onClick={() => setTab('files')}>
            {t('files.title')}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'search'} onClick={openSearch} title="Ctrl+Shift+F">
            {t('search.title')}
          </button>
          {tab === 'files' && <Menu label="+" title={t('files.newFile')} items={addMenu} align="right" />}
        </div>
        {kind === 'legacy' && <p class="badge">{t('project.legacyBadge')}</p>}
        {tab === 'files' ? (
          <FileTree
            entries={entries}
            active={active}
            dirty={state.dirty}
            onOpen={(p) => void session?.open(p)}
            onRename={(p) => void renameEntry(p)}
            onDelete={(p) => void deleteEntry(p)}
          />
        ) : (
          session && <SearchPanel session={session} focusSignal={searchSignal} onChanged={() => void refresh()} />
        )}
        <input
          ref={upload}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const input = e.currentTarget
            if (input.files) void addFiles(input.files).then(() => (input.value = ''))
          }}
        />
      </aside>
      <main class="main">
        <div class="tabs" role="tablist">
          {state.open.map((path) => (
            <div key={path} role="tab" aria-selected={path === active} class={path === active ? 'tab active' : 'tab'}>
              <button type="button" class="tab-name" onClick={() => void session?.show(path)} onAuxClick={(e) => e.button === 1 && void session?.close(path)}>
                {path}
                {state.dirty.has(path) && (
                  <span class="dot" role="img" aria-label={t('tabs.unsaved')}>
                    {' '}
                    ●
                  </span>
                )}
              </button>
              <button type="button" class="tab-close" aria-label={t('tabs.close', { path })} onClick={() => void session?.close(path)}>
                ×
              </button>
            </div>
          ))}
        </div>
        <div class="editor" ref={mount} hidden={active === null || showBinary} />
        {showBinary && active && <BinaryViewer fs={fs} path={active} />}
        {active === null && <p class="empty">{t('tabs.none')}</p>}
        <div class="status">
          <span>{t(memoryOnly ? 'status.storage.memory' : 'status.storage.opfs')}</span>
          <span>{state.dirty.size > 0 ? t('status.saving') : t('status.saved')}</span>
        </div>
      </main>
      <WorldPanel runner={runner} onJump={(loc) => void program.jumpTo(loc)} />
      </div>
      {memoryOnly && (
        <div class="banner" role="alert">
          {t('project.memoryWarning')}
        </div>
      )}
      {dragging && <div class="drop-hint">{t('files.dropHint')}</div>}
      {showPackages && (
        <PackagesDialog
          packages={settings.packages}
          install={(requirement) => runner.install(requirement, runtimeConfig(settings, catalog))}
          onChange={(packages) => void updateSettings({ packages })}
          onClose={() => setShowPackages(false)}
        />
      )}
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Workspace, FileEntry } from '../workspace'
import { renamePath, uniquePath } from '../workspace'
import { t, useLang } from '../i18n'
import { addImport, canSubclass, classNameProblem, classPath, classSource, removeImport, subclassSource, CLASS_DIR, type BaseClass, type ClassKind } from '../project/classes'
import { useLanguage } from '../language/useLanguage'
import type { LanguageService } from '../language/service'
import { ImageDialog } from './ImageDialog'
import { imageSize, mimeOf } from '../miniworlds/imageLibrary'
import { classImagePath, fitSize, setClassImage } from '../project/classImage'
import { classSource as modelClassSource } from '../uml/model'
import { UmlDiagram } from '../uml/UmlDiagram'
import { classAtLine, signatures, staleClasses, type Member, type ModelClass } from '../uml/model'
import { useClassModel } from '../uml/useModel'
import { openContextMenu } from './ContextMenu'
import { detectKind, ENTRY_DEFAULT } from '../project/manifest'
import { isImagePath, isTextPath } from '../project/search'
import type { Catalog } from '../packages/catalog'
import { useCachedVersions } from '../pwa/offline'
import { useOnline } from '../pwa/useOnline'
import { updateStatus } from '../packages/versions'
import type { Runner } from '../runtime/runner'
import { runtimeConfig, useProgram } from './useProgram'
import { useSettings } from './useSettings'
import { useCatalog } from './hooks'
import { PackagesDialog } from './PackagesDialog'
import { WorldPanel } from './WorldPanel'
import { useMiniworlds, useMiniworldsMeta } from '../miniworlds/useMiniworlds'
import { engineTier } from '../packages/versions'
import { useAutoReload } from './useAutoReload'
import { useAutoReloadSetting, useMode } from './useMode'
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
  language: LanguageService
  /** The parent calls this to flush unsaved edits before export, switching projects, etc. */
  registerFlush: (flush: (() => Promise<void>) | null) => void
  /** The project belongs to a page that embeds the editor: no "saved in the browser" notes. */
  embedded?: boolean
}

export function ProjectView({ workspace, projectName, runner, catalog, language, registerFlush, embedded = false }: Props) {
  const lang = useLang()
  const { fs } = workspace
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [session, setSession] = useState<Session | null>(null)
  const [tab, setTab] = useState<'files' | 'search' | 'classes'>('files')
  const [details, setDetails] = useState(true)
  const [cursor, setCursor] = useState<{ path: string; line: number } | null>(null)
  const [pickedClass, setPickedClass] = useState<string | null>(null)
  const [loadedSigs, setLoadedSigs] = useState<Record<string, string> | null>(null)
  const [searchSignal, setSearchSignal] = useState(0)
  const [dragging, setDragging] = useState(false)
  const mount = useRef<HTMLDivElement>(null)
  const metaFlush = useRef<() => Promise<void>>(async () => {})
  const host = useRef<EditorHost | null>(null)
  const upload = useRef<HTMLInputElement>(null)
  const state = useSessionState(session)
  const kind = detectKind(entries)
  const [showPackages, setShowPackages] = useState(false)
  const [problems, setProblems] = useState(0)
  const [imageFor, setImageFor] = useState<string | null>(null)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [dismissedUpdate, setDismissedUpdate] = useState<string | null>(null)

  const refresh = useCallback(async () => setEntries(await fs.list()), [fs])
  const { settings, loaded: settingsLoaded, update: updateSettings } = useSettings(fs, kind, projectName, session)
  const { data: versions, status: catalogStatus } = useCatalog(catalog)
  const [mode, setMode] = useMode(projectName)
  const [autoReload, setAutoReload] = useAutoReloadSetting()
  // The Miniworlds view needs the ScenarioHost, which exists from miniworlds 4.4.0.15 on.
  const effectiveVersion = settings.miniworlds ?? versions?.latest ?? null
  const miniworldsSupported = effectiveVersion === null || engineTier(effectiveVersion) === 'full'
  const view = mode === 'miniworlds' && miniworldsSupported ? 'miniworlds' : 'program'
  const program = useProgram({ runner, catalog, fs, session, host, settings, settingsLoaded, mode: view, refresh })
  const metaApi = useMiniworldsMeta(fs, refresh)
  metaFlush.current = metaApi.flush
  const gf = useMiniworlds(runner, metaApi)
  const reloader = useAutoReload({ enabled: view === 'miniworlds' && autoReload, session, runner, fs, reload: () => void program.run() })
  const installedVersion = program.state.version
  const modelSupported = installedVersion ? engineTier(installedVersion) === 'full' : miniworldsSupported
  const classModel = useClassModel({ runner, session, fs, supported: modelSupported, ready: installedVersion !== null && program.state.phase !== 'booting', fileSignal: entries })
  const languageState = useLanguage({
    language,
    runner,
    fs,
    session,
    host,
    installedVersion,
    configuredVersion: settings.miniworlds ?? versions?.latest ?? null,
    hasApiIndex: modelSupported,
    fileSignal: entries,
  })
  // "changed since the world was started": remember each class's source when the world becomes ready
  const modelRef = useRef(classModel)
  modelRef.current = classModel
  useEffect(() => {
    if (gf.state.active && modelRef.current.model) setLoadedSigs(signatures(modelRef.current.model, modelRef.current.files))
  }, [gf.state.active])
  const stale = useMemo(() => (classModel.model ? staleClasses(classModel.model, classModel.files, loadedSigs) : new Set<string>()), [classModel.model, classModel.files, loadedSigs])
  // thumbnails of class images in the diagram
  useEffect(() => {
    if (!classModel.model) return
    const urls: string[] = []
    let stale = false
    void (async () => {
      const out: Record<string, string> = {}
      for (const c of classModel.model?.classes ?? []) {
        const path = classImagePath(modelClassSource(c, classModel.files))
        if (!path || !(await fs.exists(path))) continue
        const url = URL.createObjectURL(new Blob([(await fs.readBytes(path)) as BlobPart], { type: mimeOf(path) }))
        urls.push(url)
        out[c.name] = url
      }
      if (!stale) setThumbs(out)
    })()
    return () => {
      stale = true
      urls.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [classModel.model, classModel.files, fs, entries])

  async function applyImage(className: string, path: string) {
    setImageFor(null)
    const info = classModel.model?.classes.find((c) => c.name === className)
    if (!info || !session) return
    const size = await imageSize(await fs.readBytes(path), path).then((d) => (d ? fitSize(d[0], d[1]) : null))
    const edit = setClassImage(await session.readText(info.file), info, path, size)
    if (!edit.ok) return void (await infoDialog(t('dialog.error'), t('image.oneLineSetup', { name: className, path })))
    await session.writeText(info.file, edit.text)
    await refresh()
    classModel.refresh()
  }

  const cursorClass = classModel.model && cursor ? classAtLine(classModel.model, cursor.path, cursor.line) : null
  async function switchView(next: 'program' | 'miniworlds') {
    if (next === mode) return
    if (program.busy) await program.stop()
    setMode(next)
  }

  // Editor + session lifecycle (one per project).
  useEffect(() => {
    let sess: Session | null = null
    const editor = new EditorHost(mount.current as HTMLElement, (path, text) => sess?.edit(path, text), lang, (path, line) => setCursor({ path, line }))
    host.current = editor
    editor.onProblems = setProblems
    sess = new Session(fs, editor)
    setSession(sess)
    registerFlush(async () => {
      await (sess as Session).saveAll()
      await metaFlush.current()
    })
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

  async function newClass(base?: BaseClass) {
    if (kind !== 'project') return void (await infoDialog(t('class.title'), t('class.onlyInProject')))
    const hasMain = await fs.exists(ENTRY_DEFAULT)
    const values = await openDialog({
      title: base ? t('class.subclassOf', { name: base.name }) : t('class.title'),
      fields: [
        { kind: 'text', key: 'name', label: t('class.name') },
        ...(base
          ? []
          : [
              {
                kind: 'select' as const,
                key: 'kind',
                label: t('class.kind'),
                initial: 'actor',
                options: [
                  { value: 'actor', label: t('class.kind.actor') },
                  { value: 'world', label: t('class.kind.world') },
                  { value: 'plain', label: t('class.kind.plain') },
                ],
              },
            ]),
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
      await fs.write(classPath(name), base ? subclassSource(name, base) : classSource(values.kind as ClassKind, name))
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
  const online = useOnline()
  const noNetwork = !online || catalogStatus === 'offline' // the Service Worker may still answer PyPI from its cache
  const offlineNow = useCachedVersions(installedVersion, noNetwork)
  const versionItems: MenuItem[] = [
    { label: t('version.newestAuto') + (versions?.latest ? ` (${versions.latest})` : ''), checked: pinned === null, disabled: pinned !== null && noNetwork && !!versions?.latest && !offlineNow.includes(versions.latest), onSelect: () => void changeVersion(null) },
    ...(pinned && !versions?.versions.some((v) => v.version === pinned)
      ? [{ label: pinned, checked: true, divider: true, onSelect: () => void changeVersion(pinned) }]
      : []),
    ...(versions?.versions ?? []).map((v, i) => {
      const unavailable = noNetwork && pinned !== v.version && !offlineNow.includes(v.version)
      const label = v.tier === 'basic' ? `${v.version} · ${t('version.basic')}` : v.version
      return {
        label: unavailable ? `${label} · ${t('version.notOffline')}` : label,
        checked: pinned === v.version,
        divider: i === 0,
        disabled: unavailable,
        onSelect: () => void changeVersion(v.version),
      }
    }),
  ]

  const active = state.active
  const showBinary = active !== null && !isTextPath(active)
  const memoryOnly = workspace.kind === 'memory' && !embedded

  // ---- class diagram ----
  function baseOf(info: ModelClass | null, name: string): BaseClass | null {
    if (info) return { name, user: true, kind: info.kind, file: info.file }
    const lib = classModel.model?.libraries.find((l) => l.name === name)
    return lib ? { name, user: false, kind: lib.kind } : null
  }

  function onUmlSelect(info: ModelClass | null, name: string) {
    setPickedClass(name)
    if (info) void session?.open(info.file, { line: info.line, column: 0, length: 0 })
  }

  function onUmlMember(info: ModelClass, _kind: 'attribute' | 'method', member: Member) {
    setPickedClass(info.name)
    void session?.open(info.file, { line: member.line, column: 0, length: 0 })
  }

  function onUmlMenu(event: MouseEvent, info: ModelClass | null, name: string) {
    const base = baseOf(info, name)
    const items: Parameters<typeof openContextMenu>[2] = [{ header: name }]
    if (info?.kind === 'actor') {
      items.push(
        gf.state.active
          ? { text: t('uml.menu.newObject', { name }), run: () => void gf.controller.arm(name) }
          : { header: t('uml.menu.noWorld') },
      )
    }
    if (info) items.push({ text: t('uml.menu.source'), run: () => onUmlSelect(info, name) })
    if (info?.kind === 'actor') items.push({ text: t('uml.menu.image'), run: () => setImageFor(name) })
    if (base && kind === 'project' && canSubclass(base)) {
      items.push('-', { text: t('uml.menu.subclass', { name }), run: () => void newClass(base) })
    }
    if (items.length > 1) openContextMenu(event.clientX, event.clientY, items)
  }

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
        <div class="segmented" role="group" aria-label={t('mode.label')}>
          <button type="button" aria-pressed={view === 'program'} onClick={() => void switchView('program')}>
            {t('mode.program')}
          </button>
          <button
            type="button"
            aria-pressed={view === 'miniworlds'}
            disabled={!miniworldsSupported}
            title={miniworldsSupported ? undefined : t('mode.needsFull')}
            onClick={() => void switchView('miniworlds')}
          >
            {t('mode.miniworlds')}
          </button>
        </div>
        {view === 'miniworlds' && (
          <label class="inline small">
            <input type="checkbox" checked={autoReload} onChange={(e) => setAutoReload(e.currentTarget.checked)} />
            <span>{t('miniworlds.autoReload')}</span>
          </label>
        )}
        <span class="spacer" />
        <Menu
          label={`${t('version.label', { version: pinned ?? t('version.newest') })} ▾`}
          title={t('version.menuTitle')}
          items={versionItems}
          align="right"
        />
        {noNetwork && <span class="muted small">{t('version.offline')}</span>}
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
      {reloader.problem && view === 'miniworlds' && (
        <div class="notice error" role="alert">
          <span>{t('miniworlds.syntaxError', { path: reloader.problem.path, line: reloader.problem.line, message: reloader.problem.message })}</span>
          <button type="button" onClick={() => void program.jumpTo({ path: reloader.problem?.path ?? '', line: reloader.problem?.line ?? 1 })}>
            {t('console.jump')}
          </button>
        </div>
      )}
      <div class="body">
      <aside class={tab === 'classes' ? 'sidebar wide' : 'sidebar'}>
        <div class="sidebar-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'files'} onClick={() => setTab('files')}>
            {t('files.title')}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'classes'} onClick={() => setTab('classes')}>
            {t('uml.title')}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'search'} onClick={openSearch} title="Ctrl+Shift+F">
            {t('search.title')}
          </button>
          {tab === 'files' && <Menu label="+" title={t('files.newFile')} items={addMenu} align="right" />}
        </div>
        {kind === 'legacy' && <p class="badge">{t('project.legacyBadge')}</p>}
        {tab === 'classes' ? (
          <div class="uml-panel">
            <div class="uml-tools">
              <label class="inline small">
                <input type="checkbox" checked={details} onChange={(e) => setDetails(e.currentTarget.checked)} />
                <span>{t('uml.details')}</span>
              </label>
              <button type="button" disabled={kind !== 'project'} onClick={() => void newClass()}>
                {t('uml.newClass')}
              </button>
            </div>
            {classModel.status !== 'ready' && <p class="muted small uml-note">{t(`uml.${classModel.status}` as const)}</p>}
            {classModel.model && classModel.model.errors.length > 0 && (
              <p class="uml-note small error-text">{t('uml.syntaxFiles', { files: classModel.model.errors.map((e) => e.file).join(', ') })}</p>
            )}
            <div class="uml-scroll">
              {classModel.model && (
                <UmlDiagram
                  model={classModel.model}
                  details={details}
                  counts={gf.state.byClass}
                  marks={{ selected: pickedClass, cursor: cursorClass, object: gf.state.selected?.cls ?? null, armed: gf.state.armed?.cls ?? null }}
                  stale={stale}
                  images={thumbs}
                  onSelect={onUmlSelect}
                  onMember={onUmlMember}
                  onMenu={onUmlMenu}
                />
              )}
            </div>
          </div>
        ) : tab === 'files' ? (
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
          <span class="spacer" />
          {languageState.ruff && active && active.endsWith('.py') && (
            <button type="button" class="format-button" title={t('assist.formatTitle')} onClick={() => void host.current?.format()}>
              {t('assist.format')}
            </button>
          )}
        </div>
        <div class="editor" ref={mount} hidden={active === null || showBinary} />
        {showBinary && active && <BinaryViewer fs={fs} path={active} />}
        {active === null && <p class="empty">{t('tabs.none')}</p>}
        <div class="status">
          <span>{embedded ? '' : t(memoryOnly ? 'status.storage.memory' : 'status.storage.opfs')}</span>
          {active && active.endsWith('.py') && (
            <button type="button" class="status-problems" onClick={() => host.current?.openProblems()} disabled={languageState.phase !== 'ready'}>
              {languageState.phase === 'booting' || languageState.phase === 'idle'
                ? t('assist.booting')
                : languageState.phase === 'error'
                  ? t('assist.error')
                  : problems > 0
                    ? `⚠ ${t('assist.problems', { n: problems })}`
                    : `✓ ${t('assist.noProblems')}${languageState.python ? '' : ` (${t('assist.partial')})`}`}
            </button>
          )}
          <span>{state.dirty.size > 0 ? t('status.saving') : t('status.saved')}</span>
        </div>
      </main>
      <WorldPanel
        runner={runner}
        onJump={(loc) => void program.jumpTo(loc)}
        tasks={{
          items: metaApi.meta.tasks,
          done: metaApi.meta.tasksDone,
          onToggle: (i) => metaApi.setMeta({ ...metaApi.meta, tasksDone: { ...metaApi.meta.tasksDone, [i]: !metaApi.meta.tasksDone[i] } }),
        }}
        miniworlds={
          view === 'miniworlds'
            ? { controller: gf.controller, state: gf.state, onReset: () => void program.run(), onInsert: (code) => host.current?.insertText(code) }
            : undefined
        }
      />
      </div>
      {memoryOnly && (
        <div class="banner" role="alert">
          {t('project.memoryWarning')}
        </div>
      )}
      {dragging && <div class="drop-hint">{t('files.dropHint')}</div>}
      {imageFor && (
        <ImageDialog
          fs={fs}
          className={imageFor}
          current={(() => {
            const c = classModel.model?.classes.find((x) => x.name === imageFor)
            return c ? classImagePath(modelClassSource(c, classModel.files)) : null
          })()}
          onChoose={(path) => void applyImage(imageFor, path)}
          onClose={() => setImageFor(null)}
        />
      )}
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

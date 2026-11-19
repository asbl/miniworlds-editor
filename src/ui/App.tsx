import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { DEFAULT_CONFIG, type AppConfig } from '../config/appConfig'
import { registerServiceWorker, type PwaHandle } from '../pwa/register'
import { LANGS, LANG_NAMES, getLang, setLang, t, useLang } from '../i18n'
import type { ProjectStore, Workspace } from '../workspace'
import { isLowMemory } from '../config/memory'
import { createBrowserLanguageService } from '../language/browser'
import type { LanguageService } from '../language/service'
import { Catalog } from '../packages/catalog'
import { browserKeyValue } from '../project/settings'
import { createBrowserRunner } from '../runtime/browser'
import type { Runner } from '../runtime/runner'
import { ContextMenuHost } from './ContextMenu'
import { confirmDialog, DialogHost, infoDialog, openDialog } from './dialogs'
import { launchedProject, parseLaunch, rememberLaunched, withoutLaunch, type Launch } from './launch'
import { MAX_ZIP_BYTES } from '../project/zip'
import { createShareUrl, hasSharedProject, importSharedProject, ShareError } from '../project/share'
import { ShareLink } from './ShareLink'
import { dragHasFiles, droppedFolders, fromFileList } from '../project/folder'
import { createFromTemplate, TEMPLATES } from '../templates'
import { loadPreferences, savePreferences, type Preferences } from './preferences'
import { LoadingBanner } from './LoadingBanner'
import { Menu } from './Menu'
import { ProjectView } from './ProjectView'
import {
  createStarterProject,
  duplicateProject,
  exportProjectZip,
  importProjectFolder,
  importProjectFolders,
  importProjectZip,
  lastProject,
  uniqueProjectName,
  promptDeleteProject,
  promptNewProject,
  promptRenameProject,
  rememberProject,
} from './projectOps'

interface AppProps {
  store: ProjectStore
  config?: AppConfig
  runner?: Runner
  catalog?: Catalog
  language?: LanguageService
}

function clearSharedLocation() {
  const clean = new URL(withoutLaunch(location.href), location.href)
  clean.hash = ''
  history.replaceState(null, '', clean.pathname + clean.search)
}

export function App({ store, config = DEFAULT_CONFIG, runner: injected, catalog: injectedCatalog, language: injectedLanguage }: AppProps) {
  const runner = useMemo(() => injected ?? createBrowserRunner(config.pyodideBase), [injected, config.pyodideBase])
  const language = useMemo(() => injectedLanguage ?? createBrowserLanguageService(config.pyodideBase, isLowMemory(config.lowMemory)), [injectedLanguage, config.pyodideBase, config.lowMemory])
  const catalog = useMemo(() => injectedCatalog ?? new Catalog(browserKeyValue()), [injectedCatalog])
  const lang = useLang()
  const [projects, setProjects] = useState<string[]>([])
  const [name, setName] = useState<string | null>(null)
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const flush = useRef<(() => Promise<void>) | null>(null)
  const zipInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const [update, setUpdate] = useState<PwaHandle | null>(null)
  useEffect(() => registerServiceWorker((handle) => setUpdate(handle)), [])

  /** New projects pin the newest known engine version (so the update warning can work later). Offline: unpinned. */
  async function newestVersion(): Promise<string | null> {
    await Promise.race([catalog.load(), new Promise((resolve) => setTimeout(resolve, 2000))])
    return catalog.data?.latest ?? null
  }

  async function show(next: string) {
    await flush.current?.()
    const list = await store.list()
    const ws = await store.open(next)
    rememberProject(next)
    setProjects(list.includes(next) ? list : await store.list())
    setWorkspace(ws)
    setName(next)
  }

  /** A link that opens a task (`?template=`, `?zip=`): the project is made once, the same link later opens it again. */
  async function openLaunch(launch: Launch) {
    if (launch.lang) setLang(launch.lang, false) // for this visit only: a link must not change the visitor's saved language
    const source = launch.template ? `template:${launch.template}` : `zip:${launch.zip}`
    const known = launchedProject(source)
    if (known && (await store.exists(known))) return show(known)
    if (launch.template) {
      const template = TEMPLATES.find((x) => x.id === launch.template)
      if (!template) return void (await infoDialog(t('launch.title'), t('launch.unknown', { id: launch.template })))
      const text = template.text[getLang()] ?? template.text.de
      const name = await uniqueProjectName(store, launch.name ?? text.title)
      await createFromTemplate((await store.open(name)).fs, { template, lang: getLang(), name, miniworlds: await newestVersion() })
      rememberLaunched(source, name)
      return show(name)
    }
    const address = new URL(launch.zip as string)
    if (!(await confirmDialog(t('launch.title'), t('launch.confirm', { host: address.host }), false))) return
    let bytes: ArrayBuffer
    try {
      const response = await fetch(address.href)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      bytes = await response.arrayBuffer()
      if (bytes.byteLength > MAX_ZIP_BYTES) throw new Error('too large')
    } catch (error) {
      return void (await infoDialog(t('launch.title'), t('launch.failed', { reason: error instanceof Error ? error.message : String(error) })))
    }
    const file = new File([bytes], `${launch.name ?? decodeURIComponent(address.pathname.split('/').pop() || '').replace(/\.zip$/i, '') ?? ''}.zip`)
    const name = await importProjectZip(store, file)
    if (name) {
      rememberLaunched(source, name)
      await show(name)
    }
  }

  // Shared snapshots open directly; otherwise restore local work (or a starter), then open any task link.
  useEffect(() => {
    void (async () => {
      const shared = hasSharedProject(location.hash) ? location.hash : null
      const launch = shared ? null : parseLaunch(location.search, location.href)
      if (shared) clearSharedLocation()
      else if (launch) history.replaceState(null, '', withoutLaunch(location.href)) // a reload must not repeat the task
      let sharedError: unknown
      if (shared) {
        try { await show(await importSharedProject(store, shared)); return }
        catch (error) { sharedError = error }
      }
      const list = await store.list()
      const wanted = lastProject()
      if (wanted && list.includes(wanted)) await show(wanted)
      else if (list[0]) await show(list[0])
      else {
        const starter = t('project.untitled')
        await createStarterProject(store, starter, 'project', await newestVersion())
        await show(starter)
      }
      if (shared) await infoDialog(t('share.title'), shareProblem(sharedError))
      else if (launch) await openLaunch(launch).catch((error) => infoDialog(t('dialog.error'), error instanceof Error ? error.message : String(error)))
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store])

  // Opening another project link in an already open editor can be a fragment-only navigation.
  useEffect(() => {
    const changed = () => {
      if (!hasSharedProject(location.hash)) return
      const hash = location.hash
      clearSharedLocation()
      void (async () => {
        try {
          await flush.current?.()
          await show(await importSharedProject(store, hash))
        } catch (error) { await infoDialog(t('share.title'), shareProblem(error)) }
      })()
    }
    window.addEventListener('hashchange', changed)
    return () => window.removeEventListener('hashchange', changed)
  }, [store])

  const guarded = (action: () => Promise<void>) => () =>
    void action().catch((error) => infoDialog(t('dialog.error'), error instanceof Error ? error.message : String(error)))

  const current = name as string
  function shareProblem(error: unknown): string {
    return error instanceof ShareError ? t(`share.error.${error.code}`) : t('share.error.invalid')
  }

  async function shareProject() {
    await flush.current?.()
    let url: string
    try { url = await createShareUrl((await store.open(current)).fs, current, location.href) }
    catch (error) { return infoDialog(t('share.title'), shareProblem(error)) }
    await openDialog({ title: t('share.title'), message: t('share.hint'), info: true, body: <ShareLink url={url} /> })
  }

  const projectItems = [
    { label: t('project.new'), onSelect: guarded(async () => { await flush.current?.(); const n = await promptNewProject(store, catalog.data?.latest ?? null); if (n) await show(n) }) },
    { label: t('project.rename'), onSelect: guarded(async () => { await flush.current?.(); const n = await promptRenameProject(store, current); if (n) await show(n) }) },
    { label: t('project.duplicate'), onSelect: guarded(async () => { await flush.current?.(); await show(await duplicateProject(store, current)) }) },
    {
      label: t('project.delete'),
      onSelect: guarded(async () => {
        if (!(await promptDeleteProject(store, current))) return
        const rest = await store.list()
        if (rest[0]) await show(rest[0])
        else {
          const starter = t('project.untitled')
          await createStarterProject(store, starter, 'project', await newestVersion())
          await show(starter)
        }
      }),
    },
    { label: t('share.title'), divider: true, onSelect: guarded(shareProject) },
    { label: t('project.exportZip'), onSelect: guarded(async () => { await flush.current?.(); await exportProjectZip(store, current) }) },
    { label: t('project.importFolder'), onSelect: () => folderInput.current?.click() },
    { label: t('project.importZip'), onSelect: () => zipInput.current?.click() },
    ...projects.map((p, i) => ({ label: p, checked: p === name, divider: i === 0, onSelect: guarded(() => show(p)) })),
  ]

  async function openPreferences() {
    const current = loadPreferences()
    const values = await openDialog({
      title: t('prefs.title'),
      message: t('prefs.hint'),
      fields: [
        {
          kind: 'radio',
          key: 'sidebar',
          label: t('prefs.sidebar'),
          initial: current.sidebar,
          options: [
            { value: 'classes', label: t('prefs.sidebar.classes') },
            { value: 'files', label: t('prefs.sidebar.files') },
          ],
        },
      ],
    })
    if (values) savePreferences({ sidebar: values.sidebar as Preferences['sidebar'] })
  }

  return (
    <div
      class="shell"
      // accept file drops everywhere, so that a folder dropped on the top bar is imported rather than opened by the browser
      onDragOver={(e) => dragHasFiles(e.dataTransfer) && e.preventDefault()}
      onDropCapture={(e) => {
        // a dropped folder becomes a new project (each one of several folders, too); plain files fall through to the open project
        const folders = droppedFolders(e.dataTransfer)
        if (!folders) return
        e.preventDefault()
        e.stopPropagation()
        guarded(async () => { await flush.current?.(); const n = await importProjectFolders(store, folders); if (n) await show(n) })()
      }}
    >
      <header class="topbar">
        <h1 class="brand">{t('app.title')}</h1>
        {name && <Menu label={`${t('project.menu')}: ${name} ▾`} items={projectItems} />}
        <span class="spacer" />
        {config.links.length > 0 && (
          <Menu
            label={`${t('links.menu')} ▾`}
            align="right"
            items={config.links.map((link) => ({ label: `${link.label} ↗`, onSelect: () => void window.open(link.url, '_blank', 'noopener') }))}
          />
        )}
        <button type="button" class="menu-button" title={t('prefs.button')} aria-label={t('prefs.button')} onClick={() => void openPreferences()}>
          ⚙
        </button>
        <Menu
          label={`🌐 ${LANG_NAMES[lang]} ▾`}
          title={t('lang.label')}
          align="right"
          items={LANGS.map((l) => ({ label: LANG_NAMES[l], checked: l === lang, onSelect: () => setLang(l) }))}
        />
      </header>
      {update && (
        <div class="notice" role="status" aria-label={t('pwa.reload')}>
          <span>{t(update.kind === 'waiting' ? 'pwa.update' : 'pwa.stale')}</span>
          <button type="button" class="primary" onClick={() => void update.applyUpdate(() => flush.current?.() ?? Promise.resolve())}>
            {t('pwa.reload')}
          </button>
          <button type="button" onClick={() => setUpdate(null)}>
            {t('version.later')}
          </button>
        </div>
      )}
      {workspace && name && <ProjectView key={name} workspace={workspace} projectName={name} runner={runner} catalog={catalog} language={language} registerFlush={(f) => (flush.current = f)} />}
      <input
        ref={zipInput}
        type="file"
        accept=".zip,application/zip"
        hidden
        onChange={(e) => {
          const file = e.currentTarget.files?.[0]
          e.currentTarget.value = ''
          if (file) guarded(async () => { await flush.current?.(); const n = await importProjectZip(store, file); if (n) await show(n) })()
        }}
      />
      <input
        ref={folderInput}
        type="file"
        // @ts-expect-error non-standard but supported by every current browser
        webkitdirectory={true}
        multiple
        hidden
        onChange={(e) => {
          const list = e.currentTarget.files
          const source = list && list.length > 0 ? fromFileList(list) : null
          e.currentTarget.value = ''
          if (source) guarded(async () => { await flush.current?.(); const n = await importProjectFolder(store, source); if (n) await show(n) })()
        }}
      />
      <LoadingBanner runner={runner} language={language} onReload={() => void (flush.current?.() ?? Promise.resolve()).then(() => location.reload())} />
      <DialogHost />
      <ContextMenuHost />
    </div>
  )
}

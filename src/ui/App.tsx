import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { DEFAULT_CONFIG, type AppConfig } from '../config/appConfig'
import { registerServiceWorker, type PwaHandle } from '../pwa/register'
import { LANGS, LANG_NAMES, setLang, t, useLang } from '../i18n'
import type { ProjectStore, Workspace } from '../workspace'
import { createBrowserLanguageService } from '../language/browser'
import type { LanguageService } from '../language/service'
import { Catalog } from '../packages/catalog'
import { browserKeyValue } from '../project/settings'
import { createBrowserRunner } from '../runtime/browser'
import type { Runner } from '../runtime/runner'
import { ContextMenuHost } from './ContextMenu'
import { DialogHost, infoDialog } from './dialogs'
import { Menu } from './Menu'
import { ProjectView } from './ProjectView'
import {
  createStarterProject,
  duplicateProject,
  exportProjectZip,
  importProjectZip,
  lastProject,
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

export function App({ store, config = DEFAULT_CONFIG, runner: injected, catalog: injectedCatalog, language: injectedLanguage }: AppProps) {
  const runner = useMemo(() => injected ?? createBrowserRunner(config.pyodideBase), [injected, config.pyodideBase])
  const language = useMemo(() => injectedLanguage ?? createBrowserLanguageService(config.pyodideBase), [injectedLanguage, config.pyodideBase])
  const catalog = useMemo(() => injectedCatalog ?? new Catalog(browserKeyValue()), [injectedCatalog])
  const lang = useLang()
  const [projects, setProjects] = useState<string[]>([])
  const [name, setName] = useState<string | null>(null)
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const flush = useRef<(() => Promise<void>) | null>(null)
  const zipInput = useRef<HTMLInputElement>(null)
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

  // First start: reopen the last project, else the first one, else create a starter project.
  useEffect(() => {
    void (async () => {
      const list = await store.list()
      const wanted = lastProject()
      if (wanted && list.includes(wanted)) return show(wanted)
      if (list[0]) return show(list[0])
      const starter = t('project.untitled')
      await createStarterProject(store, starter, 'project', await newestVersion())
      await show(starter)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store])

  const guarded = (action: () => Promise<void>) => () =>
    void action().catch((error) => infoDialog(t('dialog.error'), error instanceof Error ? error.message : String(error)))

  const current = name as string
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
    { label: t('project.exportZip'), divider: true, onSelect: guarded(async () => { await flush.current?.(); await exportProjectZip(store, current) }) },
    { label: t('project.importZip'), onSelect: () => zipInput.current?.click() },
    ...projects.map((p, i) => ({ label: p, checked: p === name, divider: i === 0, onSelect: guarded(() => show(p)) })),
  ]

  return (
    <div class="shell">
      <header class="topbar">
        <strong class="brand">{t('app.title')}</strong>
        {name && <Menu label={`${t('project.menu')}: ${name} ▾`} items={projectItems} />}
        <span class="spacer" />
        {config.links.length > 0 && (
          <Menu
            label={`${t('links.menu')} ▾`}
            align="right"
            items={config.links.map((link) => ({ label: `${link.label} ↗`, onSelect: () => void window.open(link.url, '_blank', 'noopener') }))}
          />
        )}
        <Menu
          label={`🌐 ${LANG_NAMES[lang]} ▾`}
          title={t('lang.label')}
          align="right"
          items={LANGS.map((l) => ({ label: LANG_NAMES[l], checked: l === lang, onSelect: () => setLang(l) }))}
        />
      </header>
      {update && (
        <div class="notice" role="status">
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
      <DialogHost />
      <ContextMenuHost />
    </div>
  )
}

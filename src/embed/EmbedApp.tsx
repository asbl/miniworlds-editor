import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { AppConfig } from '../config/appConfig'
import { LANG_NAMES, LANGS, setLang, t, useLang } from '../i18n'
import { createBrowserLanguageService } from '../language/browser'
import type { LanguageService } from '../language/service'
import { Catalog } from '../packages/catalog'
import { browserKeyValue } from '../project/settings'
import { createBrowserRunner } from '../runtime/browser'
import type { Runner } from '../runtime/runner'
import { ContextMenuHost } from '../ui/ContextMenu'
import { DialogHost } from '../ui/dialogs'
import { Menu } from '../ui/Menu'
import { createStarterProject } from '../ui/projectOps'
import { ProjectView } from '../ui/ProjectView'
import { rememberMode } from '../ui/useMode'
import { MemoryStore, type Workspace } from '../workspace'
import { EmbedBridge, type BridgeWindow } from './bridge'
import { collectFiles, replaceFiles } from './files'
import { observeFs } from './observedFs'
import type { Incoming } from './protocol'

const PROJECT = 'embed'
const CHANGE_DELAY_MS = 500
/** Without a `load` from the page (the iframe opened on its own) the editor starts with an empty project. */
const STANDALONE_AFTER_MS = 1500

interface Props {
  config: AppConfig
  /** Tests and special hosts replace these. */
  runner?: Runner
  catalog?: Catalog
  language?: LanguageService
  win?: BridgeWindow
}

/**
 * The editor inside another page. The project lives in memory only (never in the browser's project storage, which belongs to
 * the visitor and must stay out of reach of the embedding page); the page loads and fetches it through `EmbedBridge`.
 */
export function EmbedApp({ config, runner: injected, catalog: injectedCatalog, language: injectedLanguage, win }: Props) {
  const runner = useMemo(() => injected ?? createBrowserRunner(config.pyodideBase), [injected, config.pyodideBase])
  const language = useMemo(() => injectedLanguage ?? createBrowserLanguageService(config.pyodideBase), [injectedLanguage, config.pyodideBase])
  const catalog = useMemo(() => injectedCatalog ?? new Catalog(browserKeyValue()), [injectedCatalog])
  const lang = useLang()
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [revision, setRevision] = useState(0)
  const flush = useRef<(() => Promise<void>) | null>(null)

  useEffect(() => {
    const store = new MemoryStore()
    let changeTimer: ReturnType<typeof setTimeout> | null = null
    let loaded = false
    let disposed = false
    let bridge: EmbedBridge | null = null

    void (async () => {
      const raw = await store.open(PROJECT)
      const observed: Workspace = {
        kind: raw.kind,
        fs: observeFs(raw.fs, () => {
          if (changeTimer) clearTimeout(changeTimer)
          changeTimer = setTimeout(() => void collectFiles(raw.fs).then((files) => bridge?.connected && bridge.send({ type: 'change', files })), CHANGE_DELAY_MS)
        }),
      }

      async function handle(message: Incoming): Promise<void> {
        if (message.type === 'get-files') {
          await flush.current?.()
          bridge?.send({ type: 'files', id: message.id, files: await collectFiles(raw.fs) })
          return
        }
        loaded = true
        if (message.lang) setLang(message.lang)
        if (message.mode) rememberMode(PROJECT, message.mode)
        await replaceFiles(raw.fs, message.files) // not the observed fs: loading is not an edit by the user
        setWorkspace(observed)
        setRevision((r) => r + 1)
        bridge?.send({ type: 'loaded', id: message.id })
      }

      bridge = new EmbedBridge(win ?? (window as unknown as BridgeWindow), config.embedOrigins, handle)
      bridge.start()
      setTimeout(() => {
        if (loaded || disposed) return
        void (async () => {
          await createStarterProject(store, PROJECT, 'project', null)
          if (!loaded && !disposed) setWorkspace(observed)
        })()
      }, STANDALONE_AFTER_MS)
    })()

    return () => {
      disposed = true
      bridge?.stop()
      if (changeTimer) clearTimeout(changeTimer)
    }
  }, [config.embedOrigins, win])

  return (
    <div class="shell embed">
      <header class="topbar">
        <strong class="brand">{t('app.title')}</strong>
        <span class="spacer" />
        <Menu label={`🌐 ${LANG_NAMES[lang]} ▾`} title={t('lang.label')} align="right" items={LANGS.map((l) => ({ label: LANG_NAMES[l], checked: l === lang, onSelect: () => setLang(l) }))} />
      </header>
      {workspace && <ProjectView embedded key={revision} workspace={workspace} projectName={PROJECT} runner={runner} catalog={catalog} language={language} registerFlush={(f) => (flush.current = f)} />}
      <DialogHost />
      <ContextMenuHost />
    </div>
  )
}

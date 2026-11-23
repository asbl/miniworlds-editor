import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { AppConfig } from '../config/appConfig'
import { LANG_NAMES, LANGS, setLang, t, useLang } from '../i18n'
import { isLowMemory } from '../config/memory'
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
import { previewFs } from './previewFs'

const PROJECT = 'embed'
const CHANGE_DELAY_MS = 150 // only coalesces a burst of writes; the message carries paths, not content
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
  const language = useMemo(() => injectedLanguage ?? createBrowserLanguageService(config.pyodideBase, isLowMemory(config.lowMemory)), [injectedLanguage, config.pyodideBase, config.lowMemory])
  const catalog = useMemo(() => injectedCatalog ?? new Catalog(browserKeyValue()), [injectedCatalog])
  const lang = useLang()
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [revision, setRevision] = useState(0)
  const flush = useRef<(() => Promise<void>) | null>(null)
  const submitNow = useRef<(() => Promise<void>) | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const canSubmit = new URLSearchParams((win as unknown as { location?: { search: string } } | undefined)?.location?.search ?? location.search).get('submit') === '1'

  useEffect(() => {
    const store = new MemoryStore()
    let changeTimer: ReturnType<typeof setTimeout> | null = null
    const changedPaths = new Set<string>()
    let loaded = false
    let disposed = false
    let bridge: EmbedBridge | null = null

    void (async () => {
      const raw = await store.open(PROJECT)
      let readOnly = false
      const observed: Workspace = {
        get readOnly() { return readOnly },
        kind: raw.kind,
        fs: observeFs(previewFs(raw.fs, () => readOnly), (paths) => {
          paths.forEach((p) => changedPaths.add(p))
          if (changeTimer) return
          changeTimer = setTimeout(() => {
            changeTimer = null
            const paths = [...changedPaths].sort()
            changedPaths.clear()
            if (bridge?.connected && paths.length > 0) bridge.send({ type: 'change', paths })
          }, CHANGE_DELAY_MS)
        }),
      }

      // messages are handled one after the other: a second `load` must not interleave with the first
      let queue: Promise<unknown> = Promise.resolve()
      const enqueue = <T,>(task: () => Promise<T>): Promise<T> => {
        const run = queue.then(task, task)
        queue = run.catch(() => {})
        return run
      }

      async function handleNow(message: Incoming): Promise<void> {
        if (message.type === 'get-files') {
          await flush.current?.()
          bridge?.send({ type: 'files', id: message.id, files: await collectFiles(raw.fs) })
          return
        }
        loaded = true
        if (message.lang) setLang(message.lang, false)
        if (message.mode) rememberMode(PROJECT, message.mode)
        await replaceFiles(raw.fs, message.files) // not the observed fs: loading is not an edit by the user
        readOnly = message.readOnly === true
        setWorkspace({ ...observed, readOnly })
        setRevision((r) => r + 1)
        bridge?.send({ type: 'loaded', id: message.id })
      }

      submitNow.current = async () => {
        await flush.current?.()
        bridge?.send({ type: 'submit', files: await collectFiles(raw.fs) })
      }
      const handle = (message: Incoming) => enqueue(() => handleNow(message))
      bridge = new EmbedBridge(win ?? (window as unknown as BridgeWindow), config.embedOrigins, handle)
      bridge.start()
      setTimeout(() => {
        if (loaded || disposed) return
        void enqueue(async () => {
          if (loaded || disposed) return // a `load` that arrived in the meantime wins
          await createStarterProject(store, PROJECT, 'project', null)
          setWorkspace(observed)
        })
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
        <h1 class="brand">{t('app.title')}</h1>
        <span class="spacer" />
        {canSubmit && (
          <button
            type="button"
            class="primary"
            disabled={!workspace}
            onClick={() => {
              void submitNow.current?.().then(() => {
                setSubmitted(true)
                setTimeout(() => setSubmitted(false), 3000)
              })
            }}
          >
            {submitted ? t('embed.submitted') : t('embed.submit')}
          </button>
        )}
        <Menu label={`🌐 ${LANG_NAMES[lang]} ▾`} title={t('lang.label')} align="right" items={LANGS.map((l) => ({ label: LANG_NAMES[l], checked: l === lang, onSelect: () => setLang(l) }))} />
      </header>
      {workspace && <ProjectView embedded key={revision} workspace={workspace} projectName={PROJECT} runner={runner} catalog={catalog} language={language} registerFlush={(f) => (flush.current = f)} />}
      <DialogHost />
      <ContextMenuHost />
    </div>
  )
}

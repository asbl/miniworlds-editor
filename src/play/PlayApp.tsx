import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { AppConfig } from '../config/appConfig'
import { LANG_NAMES, LANGS, setLang, t, useLang } from '../i18n'
import { LIBRARY, libraryBytes, placeholderBytes } from '../miniworlds/imageLibrary'
import { saveMeta } from '../miniworlds/meta'
import type { Provenance } from '../miniworlds/provenance'
import { Catalog } from '../packages/catalog'
import { ENTRY_DEFAULT } from '../project/manifest'
import { isImagePath } from '../project/search'
import { browserKeyValue } from '../project/settings'
import { createBrowserRunner } from '../runtime/browser'
import { attachInput } from '../runtime/input'
import type { Runner } from '../runtime/runner'
import { createBrowserStore } from '../workspace'
import { Console } from '../ui/Console'
import { useRunnerState } from '../ui/hooks'
import { Menu } from '../ui/Menu'
import { rememberProject, uniqueProjectName } from '../ui/projectOps'
import { TouchPad } from '../ui/TouchPad'
import { creditKinds, decodePayload, materialize, ShareError, type SharePayload } from '../share/payload'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type Loaded = { payload: SharePayload; files: Record<string, Uint8Array> }

async function load(): Promise<Loaded> {
  const payload = decodePayload(location.hash)
  const files = await materialize(payload, {
    library: async (id) => {
      const item = LIBRARY.find((l) => l.id === id)
      return item ? libraryBytes(item) : null
    },
    placeholder: placeholderBytes,
  })
  if (!(ENTRY_DEFAULT in files)) throw new ShareError('the game has no main.py')
  return { payload, files }
}

/** A shared game: only the world, a start button and (on touch screens) arrow keys. Opens the project in the editor on request. */
export function PlayApp({ config, runner: injected }: { config: AppConfig; runner?: Runner }) {
  const lang = useLang()
  const runner = useMemo(() => injected ?? createBrowserRunner(config.pyodideBase), [injected, config.pyodideBase])
  const catalog = useMemo(() => new Catalog(browserKeyValue()), [])
  const state = useRunnerState(runner)
  const slot = useRef<HTMLDivElement>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [started, setStarted] = useState(false)
  const touch = useMemo(() => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches, [])

  useEffect(() => {
    const again = () => location.reload()
    window.addEventListener('hashchange', again)
    return () => window.removeEventListener('hashchange', again)
  }, [])

  useEffect(() => {
    load().then(
      (result) => {
        setLoaded(result)
        document.title = `${result.payload.name} – ${t('app.title')}`
      },
      (error) => setProblem(error instanceof ShareError ? t('play.broken', { reason: error.message }) : String(error)),
    )
  }, [])

  async function start() {
    if (!loaded) return
    setStarted(true)
    await Promise.race([catalog.load(), sleep(2500)])
    try {
      await runner.run(loaded.files, ENTRY_DEFAULT, { miniworlds: loaded.payload.miniworlds ?? catalog.data?.latest ?? null, packages: loaded.payload.packages })
    } catch (error) {
      runner.note(error instanceof Error ? error.message : String(error), 'stderr')
    }
  }

  // the game starts by itself on arrival; a click is not needed (sound is not played anyway)
  useEffect(() => {
    if (loaded && !started) void start()
  }, [loaded])

  // the world's canvas lives in the worker; mount the current one and forward input
  useEffect(() => {
    const canvas = runner.canvas
    canvas.setAttribute('aria-label', t('run.canvasLabel'))
    slot.current?.replaceChildren(canvas)
    return attachInput(canvas, (event) => runner.sendInput(event))
  }, [runner, state.canvasGeneration])

  async function openInEditor() {
    if (!loaded) return
    const { payload, files } = loaded
    const store = await createBrowserStore()
    const name = await uniqueProjectName(store, payload.name)
    const ws = await store.open(name)
    for (const [path, bytes] of Object.entries(files)) await ws.fs.write(path, bytes)
    const images: Provenance = {}
    for (const { path, id } of payload.library) images[path] = { source: 'library', id }
    for (const path of payload.withheld) images[path] = { source: 'upload' }
    for (const path of payload.shared) images[path] = { source: 'upload', shareable: true }
    for (const path of Object.keys(files)) if (isImagePath(path) && !images[path]) images[path] = { source: 'drawn' }
    await saveMeta(ws.fs, { journal: [], tasks: [], tasksDone: {}, images })
    rememberProject(name)
    location.assign(location.pathname) // without the link part: the editor opens the project that was just made
  }

  const booting = state.phase === 'booting' || (started && state.phase === 'ready' && state.lines.length === 0 && state.mode === null)
  const bootText = state.phase === 'booting' ? t(`run.boot.${state.bootStep ?? 'pyodide'}` as 'run.boot.pyodide') : null
  const credits = loaded ? creditKinds(loaded.payload) : null
  const hasError = state.lines.some((l) => l.kind === 'stderr')

  if (problem) {
    return (
      <div class="play play-problem">
        <h1>{t('app.title')}</h1>
        <p role="alert">{problem}</p>
        <a href={location.pathname}>{t('play.toEditor')}</a>
      </div>
    )
  }

  return (
    <div class="play">
      <header class="topbar">
        <h1 class="brand">{loaded?.payload.name ?? t('app.title')}</h1>
        <span class="spacer" />
        <button type="button" onClick={() => void start()} disabled={!loaded || state.phase === 'booting' || state.phase === 'stopping'}>
          ↻ {t('play.restart')}
        </button>
        <button type="button" onClick={() => void openInEditor().catch((e) => runner.note(String(e), 'stderr'))} disabled={!loaded}>
          {t('play.openEditor')}
        </button>
        <Menu label={`🌐 ${LANG_NAMES[lang]} ▾`} title={t('lang.label')} align="right" items={LANGS.map((l) => ({ label: LANG_NAMES[l], checked: l === lang, onSelect: () => setLang(l) }))} />
      </header>
      <main class="play-stage">
        <div class="play-world">
          <div ref={slot} />
          {(bootText || (booting && !loaded)) && <p class="play-status" role="status">{bootText ?? t('play.loading')}</p>}
        </div>
        {touch && <TouchPad send={(event) => runner.sendInput(event)} />}
      </main>
      <details class="play-console" open={hasError}>
        <summary>{t('console.title')}</summary>
        <Console lines={state.lines} onClear={() => runner.clearConsole()} onJump={() => {}} />
      </details>
      <footer class="play-credits small muted">
        {t('play.madeWith')}
        {credits?.library && ` ${t('play.creditLibrary')}`}
        {credits?.shared && ` ${t('play.creditShared')}`}
        {credits?.withheld && ` ${t('play.creditWithheld')}`}
      </footer>
    </div>
  )
}

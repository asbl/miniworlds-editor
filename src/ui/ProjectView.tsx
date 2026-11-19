import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Workspace, FileEntry } from '../workspace'
import { t, useLang } from '../i18n'
import { useLanguage } from '../language/useLanguage'
import type { LanguageService } from '../language/service'
import { useClassModel } from '../uml/useModel'
import { detectKind } from '../project/manifest'
import type { Catalog } from '../packages/catalog'
import { useNarrow } from './useNarrow'
import { loadPreferences } from './preferences'
import { HistoryDialog } from '../history/HistoryDialog'
import { useHistory } from '../history/useHistory'
import { engineTier } from '../packages/versions'
import type { Runner } from '../runtime/runner'
import { runtimeConfig, useProgram } from './useProgram'
import { useSettings } from './useSettings'
import { useCatalog } from './hooks'
import { PackagesDialog } from './PackagesDialog'
import { WorldPanel } from './WorldPanel'
import { useMiniworlds, useMiniworldsMeta } from '../miniworlds/useMiniworlds'
import { useTaskChecks } from '../tasks/useTaskChecks'
import { useAutoReload } from './useAutoReload'
import { useAutoReloadSetting, useMode } from './useMode'
import { ClassPanel, useClassPanelView } from './project/ClassPanel'
import { EditorPane } from './project/EditorPane'
import { ProjectToolbar } from './project/ProjectToolbar'
import { Sidebar, type SidebarTab } from './project/Sidebar'
import { Splitter } from './project/Splitter'
import type { Pane } from './project/layout'
import { useEditorSession } from './project/useEditorSession'
import { useFileOps } from './project/useFileOps'
import { useHistoryActions } from './project/useHistoryActions'
import { useRenameClass } from './project/useRenameClass'
import { useReport } from './project/useReport'
import { usePanelWidths } from './project/usePanelWidths'
import { useSessionState } from './project/useSessionState'
import { useStaleClasses } from './project/useStaleClasses'
import { useTrace } from '../trace/useTrace'
import { LiveSync } from '../live/liveSync'
import { ApiPanel } from '../api/ApiPanel'
import { engineBaseOf, snippetFor, type ApiMember } from '../api/apiIndex'
import { useApiIndex } from '../api/useApi'
import { classAtLine, type ModelClass } from '../uml/model'
import { askEvent } from '../events/reactDialog'
import { infoDialog } from './dialogs'

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

/**
 * One open project: wires the project's state (files, session, program, world, class model, history) together and
 * lays out the toolbar, the three columns (sidebar, editor, world) and the dialogs. The parts live in `./project/`.
 */
export function ProjectView({ workspace, projectName, runner, catalog, language, registerFlush, embedded = false }: Props) {
  const lang = useLang()
  const { fs } = workspace
  const [entries, setEntries] = useState<FileEntry[]>([])
  // the sidebar opens with the person's choice (class diagram by default); a project without the class structure shows its files
  const startTab = useRef(loadPreferences().sidebar).current
  const [tab, setTab] = useState<SidebarTab>(startTab)
  const [cursor, setCursor] = useState<{ path: string; line: number } | null>(null)
  const [searchSignal, setSearchSignal] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [showPackages, setShowPackages] = useState(false)
  const [problems, setProblems] = useState(0)
  // narrow screens (tablets, phones): one pane at a time instead of three columns
  const narrow = useNarrow()
  const [pane, setPane] = useState<Pane>('editor')
  const panels = usePanelWidths()
  const metaFlush = useRef<() => Promise<void>>(async () => {})

  const refresh = useCallback(async () => setEntries(await fs.list()), [fs])
  const { mount, host, session } = useEditorSession({ fs, lang, registerFlush, flushMeta: metaFlush, refresh, onCursor: setCursor, onProblems: setProblems })
  const state = useSessionState(session)
  const kind = detectKind(entries)
  const tabDecided = useRef(false)
  useEffect(() => {
    if (tabDecided.current || entries.length === 0) return
    tabDecided.current = true
    if (kind !== 'project') setTab((now) => (now === startTab ? 'files' : now))
  }, [entries, kind, startTab])

  const historyApi = useHistory(workspace, fs, session)
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
  const sessionRef = useRef<typeof session>(null)
  sessionRef.current = session
  const live = useMemo(() => new LiveSync(runner, fs, () => sessionRef.current), [runner, fs])
  useEffect(() => {
    if (host.current) host.current.onNumberChange = () => live.request()
    return () => live.dispose()
  }, [live, host, session])
  const reloader = useAutoReload({ enabled: view === 'miniworlds' && autoReload, session, runner, fs, live, reload: () => void program.run() })
  const installedVersion = program.state.version
  const waitingForInput = program.state.input !== null
  useEffect(() => {
    if (waitingForInput) setPane('world') // the program asks for a line: the console is where to type it
  }, [waitingForInput])
  const modelSupported = installedVersion ? engineTier(installedVersion) === 'full' : miniworldsSupported
  const classModel = useClassModel({ runner, session, fs, supported: modelSupported, ready: installedVersion !== null && program.state.phase !== 'booting', fileSignal: entries })
  const stale = useStaleClasses(classModel, gf.state.active)
  const apiIndex = useApiIndex(runner, installedVersion, modelSupported)
  const cursorClass = classModel.model && cursor ? classAtLine(classModel.model, cursor.path, cursor.line) : null
  const apiStart = apiIndex ? engineBaseOf(classModel.model, apiIndex, cursorClass) : null
  const trace = useTrace(runner, (row) => host.current?.flash(row.path, row.line))
  const classView = useClassPanelView()
  const taskChecks = useTaskChecks({ meta: metaApi.meta, setMeta: metaApi.setMeta, controller: gf.controller, facts: gf.state.facts, lines: gf.runnerState.lines, model: classModel.model, files: classModel.files })
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

  const files = useFileOps({ fs, session, entries, kind, refresh, metaApi, historyApi })
  const history = useHistoryActions(fs, session, historyApi, refresh)
  const renameClassDialog = useRenameClass({ fs, session, kind, runner, classModel, metaApi, historyApi, refresh, onRenamed: classView.setPicked })
  const copyReport = useReport({ fs, session, runner, lang, settings, entries })

  async function switchView(next: 'program' | 'miniworlds') {
    if (next === mode) return
    if (program.busy) await program.stop()
    setMode(next)
  }

  async function changeVersion(version: string | null) {
    await program.stop()
    await updateSettings({ miniworlds: version })
  }

  /** "React to …": add the method for an event to a class (or show it when it is there already). */
  async function reactTo(info: ModelClass) {
    if (!session) return
    const actors = (classModel.model?.classes ?? []).filter((c) => c.kind === 'actor').map((c) => c.name)
    const built = await askEvent(info.kind === 'world' ? 'world' : 'actor', info.name, actors)
    if (!built) return
    setPane('editor')
    const existing = info.methods.find((m) => m.name === built.method)
    if (existing) {
      await session.open(info.file, { line: existing.line, column: 0, length: 0 })
      return void infoDialog(t('event.exists'), t('event.existsText', { method: built.method, name: info.name }))
    }
    await session.open(info.file, { line: info.line, column: 0, length: 0 })
    host.current?.insertBlock({ id: 'event', group: 'input', kind: 'method', code: built.code })
  }

  function insertMember(member: ApiMember) {
    if (!state.active?.endsWith('.py')) return void infoDialog(t('api.title'), t('api.noEditor'))
    setPane('editor')
    host.current?.insertBlock({ id: 'api', group: 'move', kind: 'statement', code: snippetFor(member) })
  }

  function openSearch() {
    setTab('search')
    setSearchSignal((n) => n + 1)
  }

  /** Run from the user's own action: on a narrow screen show what happens (the world and the console). */
  async function runProgram() {
    if (narrow) setPane('world')
    await historyApi.record('run') // the state that is about to run: what "it worked a minute ago" refers to
    return program.run()
  }

  function onKeyDown(event: KeyboardEvent) {
    const mod = event.ctrlKey || event.metaKey
    if (mod && event.key === 'Enter') {
      event.preventDefault()
      if (program.busy && program.state.phase === 'booting') return // already queued; stopping would discard the start-up
      void (program.busy ? program.stop() : runProgram())
    } else if (mod && event.key.toLowerCase() === 's') {
      event.preventDefault()
      if (state.active) void session?.save(state.active)
    } else if (mod && event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      openSearch()
    }
  }

  const memoryOnly = workspace.kind === 'memory' && !embedded
  const showSplitters = !narrow

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
          void files.addFiles(e.dataTransfer.files)
        }
      }}
    >
      <ProjectToolbar
        projectName={projectName}
        runner={runner}
        program={program}
        canRun={session !== null}
        onRun={() => void runProgram()}
        view={view}
        onView={(v) => void switchView(v)}
        miniworldsSupported={miniworldsSupported}
        autoReload={autoReload}
        onAutoReload={setAutoReload}
        settings={settings}
        versions={versions}
        catalogStatus={catalogStatus}
        installedVersion={installedVersion}
        onChangeVersion={(v) => void changeVersion(v)}
        onShowPackages={() => setShowPackages(true)}
        reloadProblem={reloader.problem}
        onJump={(location) => void program.jumpTo(location)}
        narrow={narrow}
        pane={pane}
        onPane={setPane}
        memoryOnly={memoryOnly}
      />
      <main class="body" ref={panels.body} style={narrow ? undefined : panels.style} data-pane={narrow ? pane : undefined}>
        <Sidebar
          tab={tab}
          onTab={setTab}
          kind={kind}
          entries={entries}
          session={session}
          active={state.active}
          dirty={state.dirty}
          historyApi={historyApi}
          searchSignal={searchSignal}
          onOpenSearch={openSearch}
          onOpenFile={(path) => {
            setPane('editor')
            void session?.open(path)
          }}
          onNewFile={() => void files.newFile()}
          onNewClass={() => void files.newClass()}
          onAddFiles={files.addFiles}
          onRename={(path) => void files.renameEntry(path)}
          onDelete={(path) => void files.deleteEntry(path)}
          onOpenSnapshot={(snapshot) => void history.openSnapshot(snapshot)}
          onSaveVersion={() => void history.saveVersion()}
          onChanged={() => void refresh()}
          api={<ApiPanel index={apiIndex} start={apiStart} onInsert={insertMember} />}
          classes={
            <ClassPanel
              view={classView}
              fs={fs}
              session={session}
              entries={entries}
              kind={kind}
              classModel={classModel}
              gf={gf}
              metaApi={metaApi}
              cursor={cursor}
              stale={stale}
              fired={trace.fired}
              refresh={refresh}
              onNewClass={(base) => void files.newClass(base)}
              onRenameClass={(info) => void renameClassDialog(info)}
              onReact={(info) => void reactTo(info)}
            />
          }
        />
        {showSplitters && <Splitter panel="sidebar" value={panels.current('sidebar')} onResize={(px) => panels.resize('sidebar', px)} onReset={() => panels.reset('sidebar')} />}
        <EditorPane
          fs={fs}
          session={session}
          state={state}
          mount={mount}
          host={host}
          language={language}
          languageState={languageState}
          problems={problems}
          embedded={embedded}
          memoryOnly={memoryOnly}
        />
        {showSplitters && <Splitter panel="world" value={panels.current('world')} onResize={(px) => panels.resize('world', px)} onReset={() => panels.reset('world')} />}
        <WorldPanel
          name={projectName}
          runner={runner}
          trace={trace}
          onReport={() => void copyReport()}
          onJump={(loc) => {
            setPane('editor') // a link in the console: show the line it points to
            void program.jumpTo(loc)
          }}
          tasks={{
            items: metaApi.meta.tasks,
            done: metaApi.meta.tasksDone,
            onToggle: taskChecks.toggle,
            hasCheck: taskChecks.hasCheck,
          }}
          miniworlds={
            view === 'miniworlds'
              ? { controller: gf.controller, state: gf.state, onReset: () => void program.run(), onInsert: (code) => host.current?.insertText(code) }
              : undefined
          }
        />
      </main>
      {dragging && <div class="drop-hint">{t('files.dropHint')}</div>}
      {history.viewing && (
        <HistoryDialog
          snapshot={history.viewing.snapshot}
          old={history.viewing.old}
          current={history.viewing.current}
          onRestoreFile={(path) => void history.restoreOne(path)}
          onRestoreAll={() => void history.restoreEverything()}
          onLabel={() => void history.labelVersion((history.viewing as NonNullable<typeof history.viewing>).snapshot)}
          onRemove={() => void history.removeVersion((history.viewing as NonNullable<typeof history.viewing>).snapshot)}
          onClose={history.close}
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

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
import { dragHasFiles, droppedFolders, fromFileList } from '../project/folder'
import { createFromTemplate, TEMPLATES } from '../templates'
import { loadPreferences, savePreferences, type Preferences } from './preferences'
import { LoadingBanner } from './LoadingBanner'
import { Menu } from './Menu'
import { FIRST_REMINDER_MS, loadBackupRecord, saveBackupRecord, shouldRemind } from './backup'
import { hasSeenWelcome, markWelcomeSeen } from './welcome/firstRun'
import { ImportGuide, Welcome, type ImportActions } from './welcome/Welcome'
import { ProjectView } from './ProjectView'
import type { Collab } from '../collab/collab'
import { History } from '../history/history'
import { readTexts } from '../history/restore'
import { CollabDialog } from '../collab/CollabDialog'
import { CODE_HOURS, inviteInLink, publishCode, resolveCode } from '../collab/code'
import { parseShortCode } from '../collab/crypto'
import { useCollabInfo } from '../collab/useCollabInfo'
import { knownPaths, rememberKnown, rememberName, rememberRoom, savedName, savedRoom } from '../collab/storage'
import { cleanName, deserializeInvite, newInvite, parseInviteHash, serializeInvite, type CollabFailure, type Invite } from '../collab/shared'
import { collectShareContext, type ShareContext } from '../share/collect'
import { ShareDialog } from '../share/ShareDialog'
import { isPlayHash } from '../share/payload'
import { hasLegacyLink, importLegacyLink } from '../share/legacy'
import {
  createStarterProject,
  createTemplateProject,
  duplicateProject,
  exportProjectZip,
  importProjectFolder,
  importProjectDropped,
  importProjectFiles,
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
  const [sharing, setSharing] = useState<ShareContext | null>(null)
  /** Working together: the session of the open project, the project as stored (without the room), and what the UI shows. */
  const [collab, setCollab] = useState<Collab | null>(null)
  const collabRef = useRef<Collab | null>(null)
  const plainWorkspace = useRef<Workspace | null>(null)
  const nameRef = useRef<string | null>(null)
  const [collabOpen, setCollabOpen] = useState(false)
  /** `connecting`: the project joins its room again in the background. */
  const [collabNote, setCollabNote] = useState<'connecting' | null>(null)
  /** Something the person must know (a refusal, files that were deleted, a file that is too big). */
  const [collabAlert, setCollabAlert] = useState<string | null>(null)
  const [collabAvailable, setCollabAvailable] = useState(false)
  const collabInfo = useCollabInfo(collab)
  const filesInput = useRef<HTMLInputElement>(null)
  /** The card for a first visit, or the import hints (from the menu). */
  const [overlay, setOverlay] = useState<'welcome' | 'import' | null>(null)
  /** The project made for a first visit; replaced when the visitor picks a template or imports a program. */
  const firstProject = useRef<string | null>(null)
  /** `hint`: the reminder that the project lives only on this device; `done`: the backup that was just made. */
  const [backupNote, setBackupNote] = useState<'hint' | 'done' | null>(null)
  useEffect(() => registerServiceWorker((handle) => setUpdate(handle)), [])

  // the menu entry exists only where a relay is set up and answers
  useEffect(() => {
    setCollabAvailable(false)
    if (!config.collabUrl) return
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 4000)
    fetch(`${config.collabUrl.replace(/^ws/, 'http')}/health`, { signal: controller.signal, cache: 'no-store' })
      .then((res) => setCollabAvailable(res.ok))
      .catch(() => {})
      .finally(() => clearTimeout(timer))
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [config.collabUrl])

  // after a while of work in a project that was never backed up (or not for a week): say where the project lives
  useEffect(() => {
    if (!name || workspace?.kind === 'memory' || !shouldRemind(loadBackupRecord(), Date.now())) return
    const timer = setTimeout(() => setBackupNote((now) => now ?? 'hint'), FIRST_REMINDER_MS)
    return () => clearTimeout(timer)
  }, [name, workspace])

  async function backup() {
    await flush.current?.()
    await exportProjectZip(store, current)
    saveBackupRecord(Date.now())
    setBackupNote('done')
  }
  useEffect(() => {
    if (backupNote !== 'done') return
    const timer = setTimeout(() => setBackupNote(null), 6000)
    return () => clearTimeout(timer)
  }, [backupNote])

  /** New projects pin the newest known engine version (so the update warning can work later). Offline: unpinned. */
  async function newestVersion(): Promise<string | null> {
    await Promise.race([catalog.load(), new Promise((resolve) => setTimeout(resolve, 2000))])
    return catalog.data?.latest ?? null
  }

  async function show(next: string) {
    await flush.current?.()
    await endSession()
    const list = await store.list()
    const ws = await store.open(next)
    rememberProject(next)
    setProjects(list.includes(next) ? list : await store.list())
    plainWorkspace.current = ws
    nameRef.current = next
    setWorkspace(ws)
    setName(next)
    closeOverlay()
    // a project that was shared when it was closed joins its room again (in the background: the project is usable at once)
    const invite = deserializeInvite(savedRoom(next))
    if (invite && config.collabUrl) void connect(next, ws, invite, savedName() || t('collab.you'), { quiet: true })
  }

  /** Leave the session of the project that is open (the stored project stays). */
  async function endSession() {
    const old = collabRef.current
    collabRef.current = null
    setCollab(null)
    setCollabNote(null)
    await old?.leave()
  }

  const reasonText = (failure: CollabFailure | null) => t(`collab.err.${failure ?? 'network'}` as 'collab.err.network')

  /**
   * Join the room of `invite` with the project `project` (its files are merged into the room, the room's files win) and show
   * the shared project. `quiet`: a reconnect after opening, whose failure is a note instead of an error. `adopt`: the project
   * was not shown yet (an invitation link); it is shown once the room let us in. Returns why not, or null.
   */
  async function connect(project: string, ws: Workspace, invite: Invite, person: string, how: { quiet?: boolean; adopt?: boolean } = {}): Promise<CollabFailure | null> {
    if (!config.collabUrl) return 'network'
    if (how.quiet) setCollabNote('connecting')
    const { Collab } = await import('../collab/collab') // Yjs only loads when somebody works together
    const session = new Collab({
      invite,
      name: person,
      url: config.collabUrl,
      known: knownPaths(project),
      onKnown: (paths) => rememberKnown(project, paths),
    })
    session.onShrunk = (path, before, after) => setCollabAlert(t('collab.shrunk', { path, before: (before / 1048576).toFixed(1), after: (after / 1048576).toFixed(1) }))
    session.onSkipped = (path, bytes) => setCollabAlert(t('collab.tooBigFile', { path, size: (bytes / 1048576).toFixed(1) }))
    // the room's files win over the ones here: what this project had before is kept in its history
    if (ws.history && !how.quiet) {
      try {
        await new History(ws.history).record(await readTexts(ws.fs, null), 'before-join')
      } catch {
        /* a safety net only */
      }
    }
    const fs = await session.join(ws.fs, how.quiet ? 5000 : 8000).catch(() => null)
    const stale = !how.adopt && nameRef.current !== project
    if (!fs || stale) {
      const failure = session.failure
      await session.leave()
      if (how.quiet && !stale) {
        setCollabNote(null)
        setCollabAlert(`${t('collab.rejoinFailed')} ${reasonText(failure)}`)
      }
      return fs ? null : failure ?? 'network'
    }
    await flush.current?.() // what was typed on the plain project meanwhile goes to disk before the shared project takes over
    await collabRef.current?.leave()
    const projects = how.adopt ? await store.list() : null
    if (how.adopt) {
      plainWorkspace.current = ws
      nameRef.current = project
      rememberProject(project)
    }
    collabRef.current = session
    rememberRoom(project, serializeInvite(invite))
    // project, workspace and session change together: a view that is still open on the old project must not outlive it
    if (projects) setProjects(projects)
    setCollab(session)
    setCollabNote(null)
    setWorkspace({ ...ws, fs })
    if (how.adopt) setName(project)
    if (session.removedOnJoin.length > 0) setCollabAlert(t('collab.deletedOnJoin', { files: session.removedOnJoin.join(', ') }))
    return null
  }

  async function startCollab(person: string) {
    const who = cleanName(person)
    rememberName(who)
    rememberKnown(current, null)
    const failure = await connect(current, plainWorkspace.current as Workspace, newInvite(), who)
    if (failure) await infoDialog(t('collab.title'), reasonText(failure))
  }

  async function stopCollab() {
    const project = current
    await flush.current?.()
    await endSession()
    rememberRoom(project, null)
    rememberKnown(project, null)
    setCollabOpen(false)
    setWorkspace(plainWorkspace.current)
    setCollabNote(null)
    void infoDialog(t('collab.title'), t('collab.left'))
  }

  /** An invitation link: a project of its own for the room, so that the person's other projects stay untouched. */
  async function joinRoom(invite: Invite) {
    if (!config.collabUrl) return void (await infoDialog(t('collab.joinTitle'), t('collab.unavailable')))
    const project = `${t('collab.title')} ${invite.room}`
    const values = await openDialog({
      title: t('collab.joinTitle'),
      message: t('collab.joinText', { code: invite.room, project }) + (invite.readOnly ? ` ${t('collab.readOnly')}` : ''),
      submit: 'dialog.ok',
      fields: [{ kind: 'text', key: 'name', label: t('collab.name'), initial: savedName() }],
    })
    if (!values) return
    const who = cleanName(String(values.name))
    rememberName(who)
    await flush.current?.()
    const existed = await store.exists(project)
    const ws = await store.open(project)
    const failure = await connect(project, ws, invite, who, { adopt: true })
    if (failure) {
      if (!existed) await store.remove(project).catch(() => {})
      return void (await infoDialog(t('collab.joinTitle'), reasonText(failure)))
    }
    await dropStarter(project)
  }

  /** "Join" in the dialog: a short code or a pasted link. Returns what is wrong, or null (then the dialog closes and the join goes on). */
  async function joinByCode(text: string): Promise<string | null> {
    if (!config.collabUrl) return t('collab.unavailable')
    let invite = inviteInLink(text)
    if (!invite) {
      const code = parseShortCode(text)
      if (!code) return t('collab.join.invalid')
      try {
        invite = await resolveCode(config.collabUrl, code)
      } catch (error) {
        return error instanceof Error && error.message === 'tooMany' ? t('collab.code.tooMany') : reasonText('network')
      }
      if (!invite) return t('collab.join.notFound', { hours: CODE_HOURS })
    }
    setCollabOpen(false)
    void joinRoom(invite)
    return null
  }

  async function makeCode(): Promise<{ code: string } | { error: string }> {
    const session = collabRef.current
    if (!session || !config.collabUrl) return { error: t('collab.code.failed') }
    try {
      const code = await publishCode(config.collabUrl, session.invite)
      session.shortCode = { code, until: Date.now() + CODE_HOURS * 3600_000 }
      return { code }
    } catch (error) {
      return { error: error instanceof Error && error.message === 'tooMany' ? t('collab.code.tooMany') : t('collab.code.failed') }
    }
  }

  function closeOverlay() {
    setOverlay(null)
  }

  /** The untouched project of a first visit makes room for what the visitor chose instead (a template, an import). */
  async function dropStarter(keep: string) {
    const unused = firstProject.current
    firstProject.current = null
    if (!unused || unused === keep) return
    await store.remove(unused).catch(() => {})
    setProjects(await store.list())
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

  // First start: reopen the last project, else the first one, else create a starter project; then open the task of the link.
  useEffect(() => {
    void (async () => {
      // an older kind of project link (`#project=…`, handed out before the play links): open it as a copy of its own
      const legacy = hasLegacyLink(location.hash) ? location.hash : null
      const joinCode = parseInviteHash(location.hash)
      if (joinCode) history.replaceState(null, '', location.pathname + location.search)
      const launch = legacy ? null : parseLaunch(location.search, location.href)
      if (legacy) history.replaceState(null, '', location.pathname + location.search)
      else if (launch) history.replaceState(null, '', withoutLaunch(location.href)) // a reload must not repeat the task
      let legacyFailed = false
      if (legacy) {
        try { await show(await importLegacyLink(store, legacy)); return } catch { legacyFailed = true }
      }
      const list = await store.list()
      const wanted = lastProject()
      if (wanted && list.includes(wanted)) await show(wanted)
      else if (list[0]) await show(list[0])
      else {
        const first = t('project.untitled')
        await createStarterProject(store, first, 'project', await newestVersion())
        await show(first)
        // somebody who has never been here: say what to do first (not for a link that brings its own task)
        if (joinCode) firstProject.current = first // replaced by the project of the room
        else if (!launch && !hasSeenWelcome()) {
          firstProject.current = first
          markWelcomeSeen()
          setOverlay('welcome')
        }
      }
      if (joinCode) await joinRoom(joinCode).catch((error) => infoDialog(t('dialog.error'), error instanceof Error ? error.message : String(error)))
      if (legacyFailed) await infoDialog(t('dialog.error'), t('share.legacyFailed'))
      else if (launch) await openLaunch(launch).catch((error) => infoDialog(t('dialog.error'), error instanceof Error ? error.message : String(error)))
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store])

  /** A new project from an import or a template: show it, and let it replace the untouched project of a first visit. */
  async function showMade(made: string | null) {
    if (!made) return
    await flush.current?.()
    await show(made)
    await dropStarter(made)
  }

  const importActions: ImportActions = {
    pickFolder: () => folderInput.current?.click(),
    pickZip: () => zipInput.current?.click(),
    pickFiles: () => filesInput.current?.click(),
    dropFiles: (files) => void guarded(async () => showMade(await importProjectDropped(store, files)))(),
  }

  // A game link pasted into the address bar of an open editor only changes the part after `#`: the page does not reload by
  // itself. Save the work, then reload, so that the play page opens (the editor's own copy is untouched).
  useEffect(() => {
    const changed = () => {
      const joinCode = parseInviteHash(location.hash)
      if (joinCode) {
        history.replaceState(null, '', location.pathname + location.search)
        void joinRoom(joinCode).catch((error) => infoDialog(t('dialog.error'), error instanceof Error ? error.message : String(error)))
        return
      }
      if (hasLegacyLink(location.hash)) {
        const hash = location.hash
        history.replaceState(null, '', location.pathname + location.search)
        void (async () => {
          try {
            await flush.current?.()
            await show(await importLegacyLink(store, hash))
          } catch { await infoDialog(t('dialog.error'), t('share.legacyFailed')) }
        })()
        return
      }
      if (!isPlayHash(location.hash)) return
      void (async () => {
        try { await flush.current?.() } finally { location.reload() }
      })()
    }
    window.addEventListener('hashchange', changed)
    return () => window.removeEventListener('hashchange', changed)
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
    { label: t('project.share'), divider: true, onSelect: guarded(async () => { await flush.current?.(); setSharing(await collectShareContext(await store.open(current), current, browserKeyValue())) }) },
    { label: t('project.exportZip'), onSelect: guarded(async () => { await flush.current?.(); await exportProjectZip(store, current) }) },
    { label: t('project.importFolder'), onSelect: () => folderInput.current?.click() },
    { label: t('project.importZip'), onSelect: () => zipInput.current?.click() },
    { label: t('project.importFiles'), onSelect: () => filesInput.current?.click() },
    { label: t('project.importHelp'), onSelect: () => setOverlay('import') },
    { label: t('welcome.reopen'), onSelect: () => setOverlay('welcome') },
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
        if (folders) {
          e.preventDefault()
          e.stopPropagation()
          guarded(async () => showMade(await importProjectFolders(store, folders)))()
          return
        }
        // a dropped ZIP is a project, not a file to put into the open one
        const files = Array.from(e.dataTransfer?.files ?? [])
        if (files.length > 0 && files.every((f) => /\.zip$/i.test(f.name))) {
          e.preventDefault()
          e.stopPropagation()
          guarded(async () => showMade(await importProjectDropped(store, files)))()
        }
      }}
    >
      <header class="topbar">
        <h1 class="brand">{t('app.title')}</h1>
        {name && <Menu label={`${t('project.menu')}: ${name} ▾`} items={projectItems} />}
        <span class="spacer" />
        {name && collabAvailable && (
          <button
            type="button"
            class={collab ? `collab-button on ${collabInfo?.status ?? ''}` : 'collab-button'}
            title={collab && collabInfo ? t('collab.chip.title', { n: collabInfo.people.length }) : t('collab.button.title')}
            onClick={() => setCollabOpen(true)}
          >
            {collab && collabInfo ? `${collabInfo.readOnly ? '👁' : '👥'} ${collabInfo.status === 'connected' ? collabInfo.people.length : '⚠'}` : t('collab.button')}
          </button>
        )}
        {name && (
          <button type="button" class="backup-button" title={t('backup.title')} onClick={guarded(backup)}>
            {t('backup.button')}
          </button>
        )}
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
      {backupNote && (
        <div class="notice" role="status">
          <span>{backupNote === 'done' ? t('backup.done', { name: current }) : t('backup.hint')}</span>
          {backupNote === 'hint' && (
            <>
              <button type="button" class="primary" onClick={guarded(backup)}>
                {t('backup.hint.now')}
              </button>
              <button type="button" onClick={() => (saveBackupRecord(Date.now()), setBackupNote(null))}>
                {t('backup.hint.later')}
              </button>
            </>
          )}
        </div>
      )}
      {collabNote && (
        <div class="notice" role="status">
          <span>{t('collab.reconnecting')}</span>
        </div>
      )}
      {collabAlert && (
        <div class="notice" role="alert">
          <span>{collabAlert}</span>
          <button type="button" onClick={() => setCollabAlert(null)}>
            {t('collab.dismiss')}
          </button>
        </div>
      )}
      {collab && collabInfo && collabInfo.status === 'offline' && (
        <div class="notice" role="status">
          <span>{t('collab.offlineBanner')}</span>
        </div>
      )}
      {collab && collabInfo && collabInfo.following !== null && (
        <div class="collab-follow-bar" role="status">
          <span>{t('collab.following', { name: collabInfo.people.find((p) => p.id === collabInfo.following)?.name ?? '' })}</span>
          <button type="button" onClick={() => collab.follow(null)}>
            {t('collab.following.stop')}
          </button>
        </div>
      )}
      {collab && collabInfo && !collabInfo.readOnly && collabInfo.locked && (
        <div class="collab-follow-bar" role="status">
          <span>{t('collab.pair.locked', { name: collabInfo.people.find((p) => p.id === collabInfo.driver)?.name ?? '' })}</span>
          <button type="button" onClick={() => collab.takeWheel()}>
            🚗 {t('collab.pair.take')}
          </button>
        </div>
      )}
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
      {workspace && name && <ProjectView key={`${name}${collab ? `#${collab.invite.room}` : ''}`} collab={collab} workspace={workspace} projectName={name} runner={runner} catalog={catalog} language={language} registerFlush={(f) => (flush.current = f)} />}
      <input
        ref={zipInput}
        type="file"
        accept=".zip,application/zip"
        hidden
        onChange={(e) => {
          const file = e.currentTarget.files?.[0]
          e.currentTarget.value = ''
          if (file) guarded(async () => showMade(await importProjectZip(store, file)))()
        }}
      />
      {collabOpen && (
        <CollabDialog
          collab={collab}
          initialName={savedName()}
          onStart={async (person) => {
            await startCollab(person)
          }}
          onStop={stopCollab}
          onJoin={joinByCode}
          onCode={makeCode}
          onRename={(person) => {
            rememberName(cleanName(person))
            collabRef.current?.setName(person)
          }}
          onClose={() => setCollabOpen(false)}
        />
      )}
      {sharing && <ShareDialog context={sharing} onClose={() => setSharing(null)} />}
      <input
        ref={filesInput}
        type="file"
        multiple
        accept=".py,.png,.jpg,.jpeg,.gif,.webp,.svg,.wav,.mp3,.ogg,.txt,.json,.csv"
        hidden
        onChange={(e) => {
          const list = Array.from(e.currentTarget.files ?? [])
          e.currentTarget.value = ''
          if (list.length > 0) guarded(async () => showMade(await importProjectFiles(store, list)))()
        }}
      />
      {overlay === 'welcome' && (
        <Welcome
          actions={importActions}
          onStart={() => {
            firstProject.current = null // the visitor keeps it, so nothing may replace it later
            closeOverlay()
          }}
          onTemplate={(id) => void guarded(async () => showMade(await createTemplateProject(store, id, await newestVersion())))()}
        />
      )}
      {overlay === 'import' && <ImportGuide actions={importActions} onClose={closeOverlay} />}
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
          if (source) guarded(async () => showMade(await importProjectFolder(store, source)))()
        }}
      />
      <LoadingBanner runner={runner} language={language} onReload={() => void (flush.current?.() ?? Promise.resolve()).then(() => location.reload())} />
      <DialogHost />
      <ContextMenuHost />
    </div>
  )
}

import { useEffect, useRef, useState } from 'preact/hooks'
import { useLang } from '../i18n'
import { confirmDialog, infoDialog, openDialog } from '../ui/dialogs'
import { BackendProjects, type BackendConnection } from './projects'
import type { Task } from './client'
import { ServerActions } from './ServerActions'
import './backend.css'

interface Props {
  idleMinutes: number
  dialog: 'claim' | 'password' | null
  onDialogChange: (dialog: 'claim' | 'password' | null) => void
  manager: BackendProjects
  connection: BackendConnection | null
  flush: () => Promise<void>
  onOpen: (name: string) => Promise<void>
  onLogout: () => Promise<void>
}

export function BackendPanel({ idleMinutes, dialog, onDialogChange: setDialog, manager, connection, flush, onOpen, onLogout }: Props) {
  const lang = useLang()
  const tr = (de: string, en: string) => lang === 'de' ? de : en
  const [remoteProjects, setRemoteProjects] = useState<{id:number;title:string;read_only:boolean}[]>([])
  useEffect(() => {
    let disposed = false
    setRemoteProjects([])
    if (connection) void connection.client.json<{projects:typeof remoteProjects}>('/api/play/projects').then(data => { if (!disposed) setRemoteProjects(data.projects) }).catch(() => {})
    return () => { disposed = true }
  }, [connection])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [answerEdits, setAnswerEdits] = useState<Record<string, boolean>>({})
  const [, render] = useState(0)
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => connection?.subscribe(() => render(n => n + 1)), [connection])
  useEffect(() => setAnswerEdits({}), [connection])
  useEffect(() => { setError(''); if (dialog && !ref.current?.open) ref.current?.showModal() }, [dialog])
  const pending = manager.pendingCodes()
  const [note, setNote] = useState('')
  const latest = useRef({ connection, flush, onOpen, onLogout, idleMinutes })
  latest.current = { connection, flush, onOpen, onLogout, idleMinutes }
  const lastActive = useRef(Date.now())
  const checking = useRef(false)

  // Offer to move an existing local project into a still empty server project (right after the code was entered).
  useEffect(() => {
    if (!connection || connection.project.read_only) return
    const offered = `${manager.key(connection.name)}:offered`
    if (sessionStorage.getItem(offered)) return
    sessionStorage.setItem(offered, '1')
    void (async () => {
      const files = (await connection.local.fs.list()).filter(e => e.kind === 'file')
      const blank = files.length === 0 || files.length === 1 && files[0]!.path === 'main.py' && !(await connection.local.fs.read('main.py')).trim()
      const candidates = await manager.importCandidates(connection.name)
      if (!blank || candidates.length === 0) return
      await importDialog(connection, candidates)
    })()
  }, [connection])
  async function importDialog(target: BackendConnection, candidates: string[]) {
    const own = (await target.local.fs.list()).filter(e => e.kind === 'file')
    const empty = own.length === 0 || own.length === 1 && own[0]!.path === 'main.py' && !(await target.local.fs.read('main.py')).trim()
    const values = await openDialog({ title: tr('Vorhandenes Projekt übernehmen?', 'Use an existing project?'), danger: !empty,
      message: !empty ? tr('ACHTUNG: Der Inhalt dieses Serverprojekts wird durch das gewählte lokale Projekt ersetzt (der Server behält den Versionsverlauf).', 'WARNING: the contents of this server project are replaced by the chosen local project (the server keeps its history).') : tr('Dieses Serverprojekt ist noch leer. Du kannst ein Projekt von diesem Gerät hineinkopieren; es wird dann automatisch gespeichert. Das lokale Projekt bleibt unverändert.', 'This server project is still empty. You can copy a project from this device into it; it is then saved automatically. The local project stays unchanged.'),
      fields: [{ kind: 'select', key: 'from', label: tr('Projekt', 'Project'), initial: candidates[0]!, options: candidates.map(c => ({ value: c, label: c })) }] })
    if (!values) return
    await flush(); await manager.importLocal(target, String(values.from)); await onOpen(target.name)
  }

  // Another device saved in the meantime: load its version (nothing unsaved here) or let the student decide (a draft here).
  async function reconcile(source: BackendConnection) {
    if (checking.current) return
    checking.current = true
    try {
      const state = source.status === 'conflict' ? 'conflict' : await source.checkRemote()
      if (state === 'newer') {
        await latest.current.flush()
        await latest.current.onOpen(source.name)
        setNote(tr('Eine neuere Version von einem anderen Gerät wurde geladen.', 'A newer version from another device was loaded.'))
      } else if (state === 'conflict') {
        const values = await openDialog({ title: tr('Auf einem anderen Gerät wurde weitergearbeitet', 'Work continued on another device'),
          message: tr('Dieses Projekt wurde dort gespeichert, während hier ungespeicherte Änderungen lagen. Nichts geht verloren: Der Server behält alle früheren Stände, und die Alternative bleibt als eigenes Projekt hier.', 'This project was saved there while this device had unsaved changes. Nothing is lost: the server keeps all earlier versions, and the other version stays here as its own project.'),
          fields: [{ kind: 'radio', key: 'choice', label: tr('Welcher Stand soll gelten?', 'Which version should count?'), initial: 'server', options: [
            { value: 'server', label: tr('Stand vom anderen Gerät übernehmen', 'Use the version from the other device'), hint: tr('Meine Änderungen hier werden als eigenes Projekt aufgehoben.', 'My changes here are kept as a separate project.') },
            { value: 'mine', label: tr('Meinen Stand hier behalten', 'Keep my version here'), hint: tr('Er ersetzt den Serverstand; der alte bleibt im Versionsverlauf.', 'It replaces the server version; the old one stays in the history.') }] }] })
        if (!values) return
        await latest.current.flush()
        if (values.choice === 'server') {
          const copy = await manager.takeServer(source)
          await latest.current.onOpen(source.name)
          setNote(tr(`Stand vom anderen Gerät geladen. Deine Änderungen hier: Projekt „${copy}“.`, `Loaded the other device's version. Your changes here: project “${copy}”.`))
        } else await source.keepLocal()
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { checking.current = false }
  }
  useEffect(() => { if (connection?.status === 'conflict') void reconcile(connection) }, [connection?.status, connection])
  useEffect(() => {
    if (!connection) return
    let last = 0
    const check = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 10_000) return
      last = Date.now(); void reconcile(connection)
    }
    document.addEventListener('visibilitychange', check); window.addEventListener('focus', check); window.addEventListener('online', check)
    check()
    return () => { document.removeEventListener('visibilitychange', check); window.removeEventListener('focus', check); window.removeEventListener('online', check) }
  }, [connection])

  // Automatic sign-out after a while without input: save first; unsaved work or an unnoted personal code keep the session.
  useEffect(() => {
    if (!connection) return
    lastActive.current = Date.now()
    const active = () => { lastActive.current = Date.now() }
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
    events.forEach(e => window.addEventListener(e, active, { passive: true, capture: true }))
    let running = false
    const tick = async () => {
      manager.touch(connection.name)
      const { idleMinutes: minutes } = latest.current
      if (!minutes || running || Date.now() - lastActive.current < minutes * 60_000) return
      running = true
      try {
        await latest.current.flush(); await connection.sync()
        if (connection.dirty || manager.pendingCodes().some(p => p.name === connection.name)) { lastActive.current = Date.now() - (minutes - 5) * 60_000; return } // look again in 5 minutes
        await manager.logout(connection); await latest.current.onLogout()
        void infoDialog(tr('Automatisch abgemeldet', 'Signed out automatically'), tr('Nach längerer Pause wurde dein Projekt gespeichert und dieses Gerät abgemeldet. Gib deinen Code erneut ein, um weiterzuarbeiten.', 'After a longer break your project was saved and this device was signed out. Enter your code again to continue.'))
      } catch { /* retried on the next tick */ } finally { running = false }
    }
    const timer = setInterval(() => { void tick() }, 20_000)
    const visible = () => { if (document.visibilityState === 'visible') void tick() }
    document.addEventListener('visibilitychange', visible)
    void tick()
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visible); events.forEach(e => window.removeEventListener(e, active, { capture: true })) }
  }, [connection])
  const labels = {
    saved: tr('Auf dem Server gespeichert', 'Saved on the server'), pending: tr('Änderungen noch lokal', 'Changes still local'),
    saving: tr('Wird gespeichert…', 'Saving…'), offline: tr('Speichern fehlgeschlagen · Entwurf bleibt lokal', 'Save failed · draft kept locally'),
    conflict: tr('Neuerer Serverstand · Entwurf bleibt lokal', 'Newer server version · draft kept locally'),
    login: tr('Bitte erneut mit Code anmelden · Entwurf bleibt lokal', 'Sign in with your code again · draft kept locally'),
    readonly: tr('Schreibgeschützt', 'Read only'),
  }
  async function perform(action: () => Promise<void>) {
    if (busy) return
    setBusy(true); setError('')
    try { await action() } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false); render(n => n + 1) }
  }
  function open(kind: 'claim' | 'password') { setError(''); setDialog(kind) }
  async function taskAnswer(task: Task, id: number, checked: boolean) {
    if (!connection) return
    await connection.answer(task.assignment_id, id, checked)
  }
  return <section class="backend-panel" aria-label={tr('Projektzugang', 'Project access')}>
    {connection && <div class="notice">
        <span role="status">{connection.project.title} · {labels[connection.status]}</span>
        <button disabled={busy} type="button" onClick={() => void perform(async () => { await flush(); await connection.retry() })}>{tr('Jetzt speichern', 'Save now')}</button>
        <button type="button" onClick={() => open('password')}>{connection.project.password_protected ? tr('Passwort ändern', 'Change password') : tr('Mit Passwort schützen', 'Protect with password')}</button>
        <ServerActions base={manager.base} connection={connection} busy={busy} perform={perform} flush={flush} onOpen={onOpen} />
        <button disabled={busy} type="button" onClick={() => void perform(async () => {
          await flush(); await connection.sync()
          if (connection.dirty && !await confirmDialog(tr('Abmelden?', 'Sign out?'), tr('Es gibt ungespeicherte Änderungen. Lade vorher eine Sicherung herunter. Lokalen Entwurf trotzdem entfernen und abmelden?', 'There are unsaved changes. Download a backup first. Remove the local draft and sign out anyway?'))) return
          await manager.logout(connection); await onLogout()
        })}>{tr('Abmelden', 'Sign out')}</button>
    </div>}
    {connection && <div class="backend-projects">
      <label>{tr('Projekt', 'Project')} <select aria-label={tr('Serverprojekt', 'Server project')} value={connection.project.project_id} disabled={busy} onChange={event => {
        const id = Number(event.currentTarget.value)
        void perform(async () => {
          await flush(); await connection.sync()
          if (connection.dirty) throw new Error(tr('Bitte zuerst speichern oder den Entwurf sichern.', 'Save or back up your draft first.'))
          await onOpen((await manager.openProject(connection, id)).name)
        })
      }}>{remoteProjects.map(p => <option key={p.id} value={p.id}>{p.title}{p.read_only ? ' 🔒' : ''}</option>)}</select></label>
      <button type="button" disabled={busy || connection.project.read_only} onClick={() => void perform(async () => {
        const values = await openDialog({title:tr('Neues Serverprojekt', 'New server project'),fields:[{kind:'text',key:'title',label:tr('Projekttitel','Project title'),initial:tr('Mein Projekt','My project')}], validate:v => String(v.title).trim() ? null : tr('Bitte einen Titel eingeben.','Enter a title.')})
        if (!values) return
        await flush(); await connection.sync()
        if (connection.dirty) throw new Error(tr('Bitte zuerst speichern oder den Entwurf sichern.', 'Save or back up your draft first.'))
        await onOpen((await manager.createProject(connection, String(values.title).trim())).name)
      })}>{tr('Neues Serverprojekt', 'New server project')}</button>
    </div>}
    {note && <p role="status">{note} <button type="button" onClick={() => setNote('')}>OK</button></p>}
    {connection && !connection.project.read_only && <button type="button" disabled={busy} onClick={() => void perform(async () => {
      const candidates = await manager.importCandidates(connection.name)
      if (candidates.length === 0) throw new Error(tr('Auf diesem Gerät gibt es kein lokales Projekt zum Übernehmen.', 'There is no local project on this device to copy.'))
      await importDialog(connection, candidates)
    })}>{tr('Lokales Projekt übernehmen', 'Copy a local project here')}</button>}
    {connection?.error && connection.status !== 'conflict' && <p role="alert">{connection.error}</p>}
    {connection?.status === 'conflict' && <p>{tr('Lade über „Sicherung“ zuerst deinen Entwurf herunter. Zum Vergleichen kannst du den Serverstand als ZIP laden. Zum Übernehmen des Serverstands melde dich nach der Sicherung ab und erneut an.', 'Download your draft using “Backup” first. Download the server ZIP to compare. To use the server version, sign out after backing up and sign in again.')} <button type="button" onClick={() => void perform(async () => {
      const response = await connection.client.request('/api/play/download')
      const url = URL.createObjectURL(await response.blob()); const a = document.createElement('a'); a.href = url; a.download = 'server-projekt.zip'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    })}>{tr('Serverstand herunterladen', 'Download server version')}</button></p>}
    {connection?.project.code_expires_at && <small>{tr('Zugang gültig bis ', 'Access expires ')}{new Date(connection.project.code_expires_at).toLocaleString()}</small>}
    {error && !dialog && <p role="alert">{error}</p>}
    {pending.map(({ name, code }) => <div class="notice" role="status" key={name}>
      <span>{tr('Dein eigener Projektcode: ', 'Your personal project code: ')}<strong><code>{code}</code></strong> {tr('Bitte sicher aufbewahren. Der Vorlagencode ist jetzt verbraucht.', 'Keep it safe. The template code has now been used.')}</span>
      <button type="button" disabled={busy} onClick={() => void perform(async () => { await flush(); await manager.resume(name); await onOpen(name) })}>{tr('Projekt öffnen / erneut laden', 'Open / retry loading')}</button>
      <button type="button" onClick={() => { manager.acknowledgeCode(name); render(n => n + 1) }}>{tr('Code notiert', 'Code saved')}</button>
    </div>)}
    {connection && connection.project.tasks.length > 0 && <details>
      <summary>{tr('Aufgaben und Abgaben', 'Tasks and submissions')} ({connection.project.tasks.length})</summary>
      {connection.project.tasks.map(task => <article class="notice" key={task.assignment_id}>
        <div><h3>{task.title}</h3><p style={{ whiteSpace: 'pre-wrap' }}>{task.description}</p>
          {task.items.map(item => <p key={item.id}>{item.kind === 'checkbox' ? <label><input type="checkbox" checked={answerEdits[`${task.assignment_id}:${item.id}`] ?? task.answers[String(item.id)]?.checked ?? false} disabled={busy || connection.project.read_only || task.status === 'submitted'} onChange={e => {
            const checked = e.currentTarget.checked, key = `${task.assignment_id}:${item.id}`
            setAnswerEdits(old => ({ ...old, [key]: checked }))
            void perform(async () => {
              try { await taskAnswer(task, item.id, checked) }
              finally { setAnswerEdits(old => { const next = { ...old }; delete next[key]; return next }) }
            })
          }} /> {item.prompt}</label> : item.prompt}</p>)}
          <button type="button" disabled={busy || connection.project.read_only || task.status === 'submitted'} onClick={() => void perform(async () => {
            await flush(); await connection.sync()
            if (connection.dirty) throw new Error(tr('Bitte den Projektstand zuerst erfolgreich speichern.', 'Save the project successfully first.'))
            await connection.client.json(`/api/play/tasks/${task.assignment_id}/submit?base_revision=${connection.revision}`, 'POST', {})
            await connection.refreshTasks()
          })}>{task.status === 'submitted' ? tr('Abgegeben', 'Submitted') : tr('Projekt abgeben', 'Submit project')}</button>
        </div>
      </article>)}
    </details>}
    {dialog && <dialog ref={ref} class="dialog backend-dialog" aria-labelledby="backend-dialog-title" onCancel={event => { event.preventDefault(); if (!busy) setDialog(null) }}>
      <form onSubmit={event => {
        event.preventDefault(); const form = event.currentTarget
        const values = new FormData(form)
        void perform(async () => {
          await flush()
          if (dialog === 'claim') {
            const result = await manager.claim(String(values.get('code')), String(values.get('password') ?? ''))
            setDialog(null); await onOpen(result.name)
          } else if (connection) {
            const password = String(values.get('password'))
            if (password !== values.get('repeat')) throw new Error(tr('Die Passwörter stimmen nicht überein.', 'Passwords do not match.'))
            const result = await connection.client.json<{ token: string }>('/api/play/password', 'PUT', { current_password: values.get('current') ?? '', password })
            manager.setToken(connection, result.token)
            await connection.refreshTasks()
            setDialog(null)
            await infoDialog(tr('Passwortschutz aktiv', 'Password protection enabled'), tr('Zum Öffnen brauchst du künftig Code und Passwort. Bestehende Sitzungen wurden abgemeldet. Bei Verlust hilft deine Lehrkraft.', 'You now need your code and password to open the project. Other sessions were signed out. Ask your teacher if you forget it.'))
          }
        })
      }}>
        <h2 id="backend-dialog-title">{dialog === 'claim' ? tr('Projekt mit Code öffnen', 'Open project with code') : tr('Projekt mit Passwort schützen', 'Protect project with password')}</h2>
        {dialog === 'claim' ? <>
          <label>{tr('Projekt- oder Vorlagencode', 'Project or template code')}<input name="code" required maxLength={128} autoComplete="off" autoCapitalize="characters" spellcheck={false} /></label>
          <p><a href={`${manager.base}/recover`}>{tr('Entwürfe aus der bisherigen Oberfläche sichern', 'Recover drafts from the previous interface')}</a></p>
          <label>{tr('Passwort (falls eingerichtet)', 'Password (if set)')}<input name="password" type="password" maxLength={256} autoComplete="current-password" /></label>
        </> : <>
          {connection?.project.password_protected && <label>{tr('Aktuelles Passwort', 'Current password')}<input name="current" type="password" required maxLength={256} autoComplete="current-password" /></label>}
          <label>{tr('Neues Passwort (mindestens 12 Zeichen)', 'New password (at least 12 characters)')}<input name="password" type="password" minLength={12} maxLength={256} required autoComplete="new-password" /></label>
          <label>{tr('Passwort wiederholen', 'Repeat password')}<input name="repeat" type="password" minLength={12} maxLength={256} required autoComplete="new-password" /></label>
        </>}
        {error && <p role="alert">{error}</p>}
        <div class="dialog-buttons"><button disabled={busy} type="button" onClick={() => setDialog(null)}>{tr('Abbrechen', 'Cancel')}</button><button class="primary" disabled={busy}>{busy ? '…' : tr('Weiter', 'Continue')}</button></div>
      </form>
    </dialog>}
  </section>
}

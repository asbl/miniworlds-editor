import { useEffect, useRef, useState } from 'preact/hooks'
import { useLang } from '../i18n'
import { confirmDialog, infoDialog, openDialog } from '../ui/dialogs'
import { BackendProjects, type BackendConnection } from './projects'
import type { Task } from './client'
import './backend.css'

interface Props {
  dialog: 'claim' | 'password' | null
  onDialogChange: (dialog: 'claim' | 'password' | null) => void
  manager: BackendProjects
  connection: BackendConnection | null
  flush: () => Promise<void>
  onOpen: (name: string) => Promise<void>
  onLogout: () => Promise<void>
}

export function BackendPanel({ dialog, onDialogChange: setDialog, manager, connection, flush, onOpen, onLogout }: Props) {
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
    {connection?.error && <p role="alert">{connection.error}</p>}
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

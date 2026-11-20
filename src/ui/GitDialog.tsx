import { useEffect, useRef, useState } from 'preact/hooks'
import { t } from '../i18n'
import type { Workspace } from '../workspace'
import type { GitOperationOptions } from '../git/network'
import type { Connection, Credentials, Repository } from '../git/repository'

interface Props {
  workspace: Workspace
  clone: boolean
  onClone: (connection: Connection, credentials: Credentials, options: GitOperationOptions) => Promise<void>
  onPulled: () => void
  onClose: () => void
}

/** The Git engine is loaded only when the optional Git UI is opened. */
export function GitDialog({ workspace, clone, onClone, onPulled, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [repo, setRepo] = useState<Repository | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [changes, setChanges] = useState<string[] | null>(null)
  const [hasBackup, setHasBackup] = useState(false)
  const active = useRef<AbortController | null>(null)
  const closing = useRef(false)
  const [url, setUrl] = useState('')
  const [branch, setBranch] = useState('')
  const [proxy, setProxy] = useState('')
  const [username, setUsername] = useState('')
  const [token, setToken] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const credentials = { username, token }

  useEffect(() => {
    dialog.current?.showModal()
    let stale = false
    void import('../git/repository').then(async ({ Repository }) => {
      const opened = clone ? null : await Repository.open(workspace)
      if (stale) return
      setRepo(opened)
      if (opened) {
        setUrl(opened.connection.url); setProxy(opened.connection.proxy)
        const backup = await opened.hasRecoveryArchive()
        if (!stale) setHasBackup(backup)
      }
      const paths = opened ? await opened.changes() : []
      if (!stale) { setChanges(paths); setReady(true) }
    }).catch(e => { if (!stale) setError(String(e)) })
    return () => { stale = true; active.current?.abort() }
  }, [workspace, clone])

  function close() {
    if (active.current) { closing.current = true; active.current.abort() }
    else onClose()
  }
  async function run(action: (options: GitOperationOptions) => Promise<void>) {
    if (active.current) return
    const controller = new AbortController()
    active.current = controller
    setBusy(true); setError(''); setStatus('')
    try { await action({ signal: controller.signal }) } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      const text = e instanceof Error && e.name === 'TimeoutError' ? t('git.timeout') : detail
      if (!closing.current) setError(token ? text.split(token).join('***') : text)
    } finally {
      if (repo) {
        setHasBackup(await repo.hasRecoveryArchive().catch(() => false))
        if (!closing.current) setChanges(await repo.changes().catch(() => null))
      }
      active.current = null
      setBusy(false)
      if (closing.current) onClose()
    }
  }
  async function downloadBackup() {
    const bytes = await repo?.recoveryArchive()
    if (!bytes) return
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/zip' }))
    const link = document.createElement('a')
    link.href = url; link.download = 'before-pull.zip'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const input = (label: string, value: string, set: (v: string) => void, type: 'text' | 'password' | 'email' = 'text') => {
    const attrs = { value, disabled: busy, autocomplete: 'off', spellcheck: false,
      onInput: (e: Event) => set((e.currentTarget as HTMLInputElement).value) }
    return <div class="field"><label><span>{label}</span>{type === 'password' ? <input type="password" {...attrs} /> : type === 'email' ? <input type="email" {...attrs} /> : <input type="text" {...attrs} />}</label></div>
  }
  return (
    <dialog class="dialog git-dialog" ref={dialog} onCancel={e => { e.preventDefault(); close() }}>
      <form onSubmit={e => e.preventDefault()} aria-busy={busy}>
        <h2>{clone ? t('git.clone') : t('git.title')}</h2>
        {repo ? <p>{repo.connection.url} · {repo.connection.branch || 'HEAD'}</p> : <>
          <p class="dialog-message">{t('git.connectionHint')}</p>
          {input(t('git.url'), url, setUrl)}
          {input(t('git.branch'), branch, setBranch)}
          {input(t('git.proxy'), proxy, setProxy)}
          <p class="dialog-message">{t('git.proxyHint')}</p>
        </>}
        {repo && <details><summary>{t('git.connection')}</summary>
          {input(t('git.url'), url, setUrl)}
          {input(t('git.proxy'), proxy, setProxy)}
          <p class="dialog-message">{t('git.proxyHint')}</p>
          <button type="button" disabled={busy || !url.trim()} onClick={() => void run(async () => { await repo.updateConnection(url.trim(), proxy.trim()); setStatus(t('git.saved')) })}>{t('git.save')}</button>
        </details>}
        <details><summary>{t('git.auth')}</summary>
          <p class="dialog-message">{t('git.authHint')}</p>
          {input(t('git.username'), username, setUsername)}
          {input(t('git.token'), token, setToken, 'password')}
        </details>
        {!repo && <button type="button" disabled={!ready || busy || !url.trim()} onClick={() => void run(async options => {
          const connection = { url: url.trim(), branch: branch.trim(), proxy: proxy.trim() }
          if (clone) { await onClone(connection, credentials, options); onClose() }
          else {
            const { Repository } = await import('../git/repository')
            const created = await Repository.create(workspace, connection, false, credentials, options)
            setRepo(created); setChanges(await created.changes())
          }
        })}>{clone ? t('git.clone') : t('git.init')}</button>}
        {repo && <>
          <h3>{t('git.changes')}</h3>
          {changes === null ? <p>{t('git.unknown')}</p> : changes.length ? <ul class="git-changes">{changes.map(path => <li key={path}>{path}</li>)}</ul> : <p>{t('git.clean')}</p>}
          {input(t('git.name'), name, setName)}
          {input(t('git.email'), email, setEmail, 'email')}
          {input(t('git.message'), message, setMessage)}
          <div class="dialog-buttons">
            <button type="button" disabled={busy || !changes?.length || !message.trim() || !name.trim() || !email.trim()} onClick={() => void run(async () => {
              const oid = await repo.commit(message, { name, email })
              setChanges(await repo.changes()); setMessage(''); setStatus(`Commit ${oid.slice(0, 8)}`)
            })}>Commit</button>
            <button type="button" disabled={busy || changes === null || changes.length > 0} onClick={() => void run(async options => {
              await repo.pull(credentials, options); setChanges(await repo.changes()); onPulled(); setStatus(t('git.pulled'))
            })}>Pull</button>
            <button type="button" disabled={busy} onClick={() => void run(async options => { await repo.push(credentials, options); setStatus(t('git.pushed')) })}>Push</button>
          </div>
          <p class="dialog-message">{t('git.pullHint')}</p>
        </>}
        {hasBackup && <button type="button" disabled={busy} onClick={() => void run(downloadBackup)}>{t('git.backup')}</button>}
        {busy && <p role="status">{t('git.busy')}</p>}
        {status && <p role="status">{status}</p>}
        {error && <p class="dialog-error" role="alert">{error}</p>}
        <div class="dialog-buttons"><button type="button" onClick={close}>{t(busy ? 'git.abort' : 'git.close')}</button></div>
      </form>
    </dialog>
  )
}

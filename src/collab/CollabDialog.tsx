import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { t, useLang } from '../i18n'
import { qrModules, qrSvg } from '../share/qr'
import type { Collab } from './collab'
import { CODE_HOURS } from './code'
import { MAX_NAME, roomLink } from './shared'
import { useCollabInfo } from './useCollabInfo'

interface Props {
  collab: Collab | null
  /** Starts a session in the open project with the name that was typed. */
  onStart: (name: string) => Promise<void>
  onStop: () => Promise<void>
  /** Join by short code or link; returns what went wrong (text for the person), or null. */
  onJoin: (text: string) => Promise<string | null>
  /** Make a short code for the running session (returns it, or an error text). */
  onCode: () => Promise<{ code: string } | { error: string }>
  onRename: (name: string) => void
  initialName: string
  onClose: () => void
}

const baseUrl = () => `${location.origin}${location.pathname}`

function CopyRow({ link, label, button, big }: { link: string; label: string; button: string; big?: boolean }) {
  const [copied, setCopied] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      field.current?.select() // clipboard blocked (iframe, old browser): copied by hand
    }
  }
  return (
    <div class="share-row">
      <input ref={field} class={big ? 'share-link share-code' : 'share-link'} readOnly value={link} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
      <button type="button" onClick={() => void copy()}>
        {copied ? t('collab.copied') : button}
      </button>
    </div>
  )
}

/** Start or join a room, invite people and manage the active session. */
export function CollabDialog({ collab, onStart, onStop, onJoin, onCode, onRename, initialName, onClose }: Props) {
  useLang()
  const ref = useRef<HTMLDialogElement>(null)
  const info = useCollabInfo(collab)
  const [name, setName] = useState(initialName)
  const [busy, setBusy] = useState(false)
  const [joining, setJoining] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [code, setCode] = useState<string | null>(collab?.shortCode && collab.shortCode.until > Date.now() ? collab.shortCode.code : null)
  const link = collab && !collab.readOnly ? roomLink(collab.invite, baseUrl()) : ''
  const readInvite = collab && !collab.readOnly ? collab.readInvite() : null
  const readLink = readInvite ? roomLink(readInvite, baseUrl()) : ''
  const qr = useMemo(() => (link ? qrModules(link) : null), [link])

  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal()
  }, [])

  async function run(action: () => Promise<void>) {
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  const statusKey = info ? (info.status === 'connected' && !info.synced ? 'connecting' : info.status) : 'connecting'

  return (
    <dialog ref={ref} class="dialog wide-dialog collab-dialog" onCancel={(e) => (e.preventDefault(), onClose())} aria-labelledby="collab-title">
      <div class="dialog-body">
        <div class="collab-heading">
          <h2 id="collab-title">{t('collab.title')}</h2>
          {info && <span class={`collab-status ${statusKey}`} role="status">{t(`collab.status.${statusKey}` as 'collab.status.connected')}</span>}
        </div>
        {!collab && (
          <form
            id="collab-start"
            onSubmit={(e) => {
              e.preventDefault()
              void run(() => onStart(name))
            }}
          >
            <p class="muted small">{t('collab.intro')}</p>
            <label class="collab-name">
              {t('collab.name')}
              <input value={name} maxLength={MAX_NAME} onInput={(e) => setName(e.currentTarget.value)} />
            </label>
          </form>
        )}
        {!collab && (
          <form
            class="collab-join"
            onSubmit={(e) => {
              e.preventDefault()
              void run(async () => setProblem(await onJoin(joining)))
            }}
          >
            <label class="collab-field-label" for="collab-join-code">{t('collab.join.field')}</label>
            <div class="share-row">
              <input id="collab-join-code" value={joining} placeholder="kobi-latu-42" aria-label={t('collab.join.field')} onInput={(e) => (setJoining(e.currentTarget.value), setProblem(null))} />
              <button type="submit" disabled={busy || joining.trim() === ''}>
                {t('collab.join.button')}
              </button>
            </div>
            {problem && <p class="collab-problem" role="alert">{problem}</p>}
          </form>
        )}
        {!collab && (
          <div class="dialog-buttons">
            <button type="button" onClick={onClose}>{t('dialog.cancel')}</button>
            <button type="submit" form="collab-start" class="primary" disabled={busy}>{t('collab.start')}</button>
          </div>
        )}
        {collab && info && (
          <>
            {info.readOnly && <p class="collab-readonly">{t('collab.readOnly')}</p>}
            {link && (
              <>
                <CopyRow link={link} label={t('collab.link')} button={t('collab.copy')} />
                <p class="muted small collab-access">{t('collab.access')}</p>
                {qr && (
                  <details class="collab-qr">
                    <summary>{t('collab.qr.show')}</summary>
                    <div class="share-qr" role="img" aria-label={t('collab.qr')} dangerouslySetInnerHTML={{ __html: qrSvg(qr) }} />
                  </details>
                )}
              </>
            )}
            {link && (
              <div class="collab-code">
                {code ? (
                  <>
                    <p class="muted small collab-readlabel">{t('collab.code.hint', { hours: CODE_HOURS })}</p>
                    <CopyRow link={code} big label={t('collab.code.label')} button={t('collab.code.copy')} />
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const made = await onCode()
                        if ('code' in made) setCode(made.code)
                        else setProblem(made.error)
                      })
                    }
                  >
                    {t('collab.code.make')}
                  </button>
                )}
                {problem && <p class="collab-problem" role="alert">{problem}</p>}
              </div>
            )}
            {readLink && (
              <details class="collab-read-access">
                <summary>{t('collab.readLink.title')}</summary>
                <CopyRow link={readLink} label={t('collab.readLink')} button={t('collab.readLink.copy')} />
              </details>
            )}
            <h3 class="collab-section-title">{t('collab.people')} · {info.people.length}</h3>
            <ul class="collab-people">
              {info.people.map((p) => (
                <li key={p.id}>
                  <span class="collab-dot" style={{ background: p.color }} aria-hidden="true" />
                  {p.self ? (
                    <input class="collab-own-name" aria-label={t('collab.name')} value={p.name} maxLength={MAX_NAME} onChange={(e) => onRename(e.currentTarget.value)} />
                  ) : (
                    <span>{p.name}</span>
                  )}
                  {p.self && <span class="muted small"> ({t('collab.you')})</span>}
                  {p.readOnly && <span class="collab-badge">{t('collab.readOnlyBadge')}</span>}
                  {p.id === info.driver && <span class="collab-badge driver">{t('collab.pair.driver')}</span>}
                  {!p.self && (
                    <button type="button" class="collab-follow" aria-pressed={info.following === p.id} title={t('collab.follow.hint')} onClick={() => collab.follow(info.following === p.id ? null : p.id)}>
                      {info.following === p.id ? t('collab.unfollow') : t('collab.follow')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {!info.readOnly && (
              <details class="collab-roles" open={info.driver !== null}>
                <summary>{t('collab.pair')}</summary>
                <p class="muted small">{t('collab.pair.hint')}</p>
                <div class="collab-pair">
                  <button type="button" disabled={info.driver === collab.id} onClick={() => collab.takeWheel()}>
                    {t('collab.pair.take')}
                  </button>
                  <button type="button" disabled={info.driver === null} onClick={() => collab.releaseWheel()}>
                    {t('collab.pair.release')}
                  </button>
                </div>
              </details>
            )}
            <details><summary>{t('collab.privacyTitle')}</summary><p class="muted small">{t('collab.privacy')}</p></details>
            <div class="dialog-buttons">
              <button type="button" class="danger" disabled={busy} onClick={() => void run(onStop)}>
                {t('collab.stop')}
              </button>
              <button type="button" class="primary" onClick={onClose}>
                {t('collab.close')}
              </button>
            </div>
          </>
        )}
      </div>
    </dialog>
  )
}

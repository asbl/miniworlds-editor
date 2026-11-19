import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { t, useLang } from '../i18n'
import { qrModules, qrSvg } from '../share/qr'
import type { Collab } from './collab'
import { MAX_NAME, roomLink } from './shared'
import { useCollabInfo } from './useCollabInfo'

interface Props {
  collab: Collab | null
  /** Starts a session in the open project with the name that was typed. */
  onStart: (name: string) => Promise<void>
  onStop: () => Promise<void>
  onRename: (name: string) => void
  initialName: string
  onClose: () => void
}

const baseUrl = () => `${location.origin}${location.pathname}`

function CopyRow({ link, label, button }: { link: string; label: string; button: string }) {
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
      <input ref={field} class="share-link" readOnly value={link} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
      <button type="button" class="primary" onClick={() => void copy()}>
        {copied ? t('collab.copied') : button}
      </button>
    </div>
  )
}

/** "Work together": start a session, then the invitation links, the people in the room (follow, who drives) and how to leave. */
export function CollabDialog({ collab, onStart, onStop, onRename, initialName, onClose }: Props) {
  useLang()
  const ref = useRef<HTMLDialogElement>(null)
  const info = useCollabInfo(collab)
  const [name, setName] = useState(initialName)
  const [busy, setBusy] = useState(false)
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
  const driverName = info?.people.find((p) => p.id === info.driver)?.name

  return (
    <dialog ref={ref} class="dialog wide-dialog collab-dialog" onCancel={(e) => (e.preventDefault(), onClose())} aria-labelledby="collab-title">
      <div class="dialog-body">
        <h2 id="collab-title">{t('collab.title')}</h2>
        {!collab && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void run(() => onStart(name))
            }}
          >
            <p>{t('collab.intro')}</p>
            <label class="collab-name">
              {t('collab.name')}
              <input value={name} maxLength={MAX_NAME} onInput={(e) => setName(e.currentTarget.value)} />
            </label>
            <p class="muted small">{t('collab.privacy')}</p>
            <div class="dialog-buttons">
              <button type="button" onClick={onClose}>
                {t('dialog.cancel')}
              </button>
              <button type="submit" class="primary" disabled={busy}>
                {t('collab.start')}
              </button>
            </div>
          </form>
        )}
        {collab && info && (
          <>
            <p class={`collab-status ${info.status}`} role="status">
              {t(`collab.status.${statusKey}` as 'collab.status.connected')}
            </p>
            {info.readOnly && <p class="collab-readonly">{t('collab.readOnly')}</p>}
            {link && (
              <>
                <CopyRow link={link} label={t('collab.link')} button={t('collab.copy')} />
                {qr && <div class="share-qr" role="img" aria-label={t('collab.qr')} dangerouslySetInnerHTML={{ __html: qrSvg(qr) }} />}
              </>
            )}
            {readLink && (
              <>
                <p class="muted small collab-readlabel">{t('collab.readLink')}</p>
                <CopyRow link={readLink} label={t('collab.readLink')} button={t('collab.readLink.copy')} />
              </>
            )}
            <h3 class="muted small">{t('collab.people')}</h3>
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
                  {p.readOnly && <span class="collab-badge">👁 {t('collab.readOnlyBadge')}</span>}
                  {p.id === info.driver && <span class="collab-badge driver">🚗 {t('collab.pair.driver')}</span>}
                  {!p.self && (
                    <button type="button" class="collab-follow" aria-pressed={info.following === p.id} onClick={() => collab.follow(info.following === p.id ? null : p.id)}>
                      {info.following === p.id ? t('collab.unfollow') : t('collab.follow')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <p class="muted small">{t('collab.follow.hint')}</p>
            {!info.readOnly && (
              <>
                <h3 class="muted small">{t('collab.pair')}</h3>
                <p class="muted small">{t('collab.pair.hint')}</p>
                <div class="collab-pair">
                  <button type="button" disabled={info.driver === collab.id} onClick={() => collab.takeWheel()}>
                    🚗 {t('collab.pair.take')}
                  </button>
                  <button type="button" disabled={info.driver === null} onClick={() => collab.releaseWheel()}>
                    {t('collab.pair.release')}
                  </button>
                  {driverName && info.driver !== collab.id && <span class="muted small">{t('collab.pair.locked', { name: driverName })}</span>}
                </div>
              </>
            )}
            <p class="muted small">{t('collab.privacy')}</p>
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

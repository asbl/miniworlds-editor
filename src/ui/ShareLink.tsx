import { useRef, useState } from 'preact/hooks'
import { t } from '../i18n'
import { SHARE_URL_WARNING } from '../project/share'

export function ShareLink({ url }: { url: string }) {
  const input = useRef<HTMLTextAreaElement>(null)
  const [status, setStatus] = useState('')
  const [qr, setQr] = useState<string | null>(null)
  const [qrBusy, setQrBusy] = useState(false)
  const [qrError, setQrError] = useState(false)
  async function showQr() {
    if (qr) { setQr(null); return }
    setQrBusy(true)
    setQrError(false)
    try {
      const { toDataURL } = await import('qrcode')
      setQr(await toDataURL(url, { errorCorrectionLevel: 'M', margin: 4, scale: 6 }))
    } catch {
      setQrError(true)
    } finally {
      setQrBusy(false)
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setStatus(t('share.copied'))
    } catch {
      input.current?.focus()
      input.current?.select()
      setStatus(t('share.manual'))
    }
  }
  return <div>
    <label class="field">
      <span>{t('share.link')}</span>
      <textarea ref={input} readOnly value={url} rows={3} style={{ width: '100%', boxSizing: 'border-box' }} onFocus={(e) => e.currentTarget.select()} />
    </label>
    <p>{t('share.length', { count: url.length })}</p>
    {url.length > SHARE_URL_WARNING && <p class="notice">{t('share.long')}</p>}
    <button type="button" onClick={() => void copy()}>{t('share.copy')}</button>
    <p role="status">{status}</p>
    <button type="button" disabled={qrBusy} aria-expanded={!!qr} onClick={() => void showQr()}>
      {t(qrBusy ? 'share.qr.loading' : qr ? 'share.qr.hide' : 'share.qr.show')}
    </button>
    {qrError && <p role="alert">{t('share.qr.unavailable')}</p>}
    {qr && <div class="share-qr">
      <img src={qr} alt={t('share.qr.alt')} />
      <p>{t('share.qr.hint')}</p>
      <a href={qr} download="miniworlds-projekt-qr.png">{t('share.qr.download')}</a>
    </div>}
  </div>
}

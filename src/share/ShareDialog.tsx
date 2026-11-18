import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { t, useLang } from '../i18n'
import { LIBRARY } from '../miniworlds/imageLibrary'
import { mimeOf } from '../miniworlds/imageLibrary'
import { buildPayload, classifyImages, encodeLink, LINK_MAX, LINK_WARN } from './payload'
import type { ShareContext } from './collect'
import { qrModules, qrSvg } from './qr'

const LIBRARY_IDS: ReadonlySet<string> = new Set(LIBRARY.map((l) => l.id))

/** The editor's own address, without `#…` and without `?…`: where a shared game opens. */
const baseUrl = () => `${location.origin}${location.pathname}`

/**
 * "Share": the game as a link (and a QR code). The pupil sees which pictures travel along and has to vouch for every
 * uploaded one; everything not vouched for is replaced by a placeholder in the link.
 */
export function ShareDialog({ context, onClose }: { context: ShareContext; onClose: () => void }) {
  useLang()
  const ref = useRef<HTMLDialogElement>(null)
  const [allowed, setAllowed] = useState<ReadonlySet<string>>(new Set())
  const [copied, setCopied] = useState(false)
  const report = useMemo(() => classifyImages(Object.keys(context.files), context.provenance, LIBRARY_IDS), [context])
  const previews = useMemo(() => Object.fromEntries(report.uploads.map((path) => [path, URL.createObjectURL(new Blob([context.files[path] as BlobPart], { type: mimeOf(path) }))])), [report, context])

  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal()
    return () => Object.values(previews).forEach((u) => URL.revokeObjectURL(u))
  }, [previews])

  const link = useMemo(
    () => encodeLink(buildPayload({ ...context, libraryIds: LIBRARY_IDS, allowed }), baseUrl()),
    [context, allowed],
  )
  const qr = useMemo(() => (link.length <= LINK_MAX ? qrModules(link) : null), [link])
  const tooBig = link.length > LINK_MAX
  const withheld = report.uploads.filter((p) => !allowed.has(p))

  function toggle(path: string) {
    const next = new Set(allowed)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    setAllowed(next)
    setCopied(false)
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      const field = ref.current?.querySelector<HTMLInputElement>('.share-link')
      field?.select() // clipboard blocked (iframe, old browser): the pupil copies by hand
    }
  }

  return (
    <dialog ref={ref} class="dialog wide-dialog share-dialog" onCancel={(e) => (e.preventDefault(), onClose())}>
      <div class="dialog-body">
        <h2>{t('share.title', { name: context.name })}</h2>
        <p>{t('share.intro')}</p>

        {report.library.length + report.drawn.length + report.uploads.length > 0 && (
          <section class="share-images" aria-label={t('share.images')}>
            <h3 class="muted small">{t('share.images')}</h3>
            {report.library.length > 0 && <p class="share-ok">✓ {t('share.libraryImages', { n: report.library.length })}</p>}
            {report.drawn.length > 0 && <p class="share-ok">✓ {t('share.drawnImages', { n: report.drawn.length })}</p>}
            {report.uploads.length > 0 && (
              <div class="share-uploads">
                <p class="share-warn">⚠ {t('share.uploadedImages', { n: report.uploads.length })}</p>
                {report.uploads.map((path) => (
                  <label key={path} class="share-upload">
                    <input type="checkbox" checked={allowed.has(path)} onChange={() => toggle(path)} />
                    <img src={previews[path]} alt="" />
                    <span>
                      <code>{path}</code>
                      <br />
                      <span class="muted small">{t('share.vouch')}</span>
                    </span>
                  </label>
                ))}
                {withheld.length > 0 && <p class="muted small">{t('share.withheld', { n: withheld.length })}</p>}
              </div>
            )}
          </section>
        )}

        {tooBig ? (
          <p class="share-warn" role="alert">
            {t('share.tooBig')}
          </p>
        ) : (
          <>
            <div class="share-row">
              <input class="share-link" readOnly value={link} aria-label={t('share.link')} onFocus={(e) => e.currentTarget.select()} />
              <button type="button" class="primary" onClick={() => void copy()}>
                {copied ? t('share.copied') : t('share.copy')}
              </button>
            </div>
            <p class="muted small">{link.length > LINK_WARN ? t('share.long', { n: link.length }) : t('share.length', { n: link.length })}</p>
            {qr ? (
              <div class="share-qr" role="img" aria-label={t('share.qr')} dangerouslySetInnerHTML={{ __html: qrSvg(qr) }} />
            ) : (
              <p class="muted small">{t('share.noQr')}</p>
            )}
          </>
        )}
        <p class="muted small">{t('share.privacy')}</p>
        <div class="dialog-buttons">
          <button type="button" onClick={onClose}>
            {t('dialog.ok')}
          </button>
        </div>
      </div>
    </dialog>
  )
}

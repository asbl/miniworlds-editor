import { useEffect, useRef, useState } from 'preact/hooks'
import { CATEGORIES, LIBRARY, libraryBytes, libraryDataUrl, mimeOf, type LibraryCategory } from '../miniworlds/imageLibrary'
import type { ImageSource } from '../miniworlds/provenance'
import { t, useLang, type MessageKey } from '../i18n'
import { isImagePath } from '../project/search'
import { uniquePath, type Fs } from '../workspace'
import { openDialog } from './dialogs'
import { PixelEditor } from './PixelEditor'
import { useMemo } from 'preact/hooks'

interface Props {
  fs: Fs
  className: string
  /** A world gets a background (the backgrounds tab comes first), an actor a picture. */
  mode?: 'actor' | 'world'
  current: string | null
  /** The user picked (or added) an image of the project; `source` is where a new image came from (undefined: it was there already). */
  onChoose: (path: string, source?: ImageSource) => void
  onClose: () => void
}

const NOTICE_KEY = 'miniworlds-editor.uploadNotice'
const noticeSeen = () => {
  try {
    return localStorage.getItem(NOTICE_KEY) === '1'
  } catch {
    return false
  }
}

/** "Set image …": pick from the project, from the built-in library, or upload. New images go to images/. */
export function ImageDialog({ fs, className, mode = 'actor', current, onChoose, onClose }: Props) {
  useLang()
  const ref = useRef<HTMLDialogElement>(null)
  const upload = useRef<HTMLInputElement>(null)
  const [mine, setMine] = useState<{ path: string; url: string }[]>([])
  const [category, setCategory] = useState<LibraryCategory>(mode === 'world' ? 'backgrounds' : 'figures')
  const [drawing, setDrawing] = useState(false)
  const shown = useMemo(() => LIBRARY.filter((l) => l.category === category).map((item) => ({ item, url: libraryDataUrl(item) })), [category])

  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal()
  }, [])

  useEffect(() => {
    const urls: string[] = []
    let stale = false
    void (async () => {
      const out: { path: string; url: string }[] = []
      for (const e of await fs.list()) {
        if (e.kind !== 'file' || !isImagePath(e.path)) continue
        const url = URL.createObjectURL(new Blob([(await fs.readBytes(e.path)) as BlobPart], { type: mimeOf(e.path) }))
        urls.push(url)
        out.push({ path: e.path, url })
      }
      if (!stale) setMine(out)
    })()
    return () => {
      stale = true
      urls.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [fs])

  async function fromLibrary(id: string) {
    const item = LIBRARY.find((l) => l.id === id)
    if (!item) return
    const path = `images/${id}.png`
    if (!(await fs.exists(path))) await fs.write(path, await libraryBytes(item))
    onChoose(path, { source: 'library', id })
  }

  async function fromFile(file: File) {
    const base = file.name.replace(/[^\w\-.]+/g, '_')
    const path = await uniquePath(fs, `images/${base}`)
    await fs.write(path, new Uint8Array(await file.arrayBuffer()))
    onChoose(path, { source: 'upload' })
  }

  async function saveDrawing(png: Uint8Array) {
    const path = await uniquePath(fs, 'images/gezeichnet.png')
    await fs.write(path, png)
    onChoose(path, { source: 'drawn' })
  }

  /** Pictures from the internet are usually protected: say so once before the file picker opens. */
  async function askUpload() {
    if (!noticeSeen()) {
      const ok = await openDialog({ title: t('image.notice.title'), message: t('image.notice.body'), submit: 'dialog.ok' })
      if (!ok) return
      try {
        localStorage.setItem(NOTICE_KEY, '1')
      } catch {
        /* private mode: the notice just comes again */
      }
    }
    upload.current?.click()
  }

  return (
    <dialog ref={ref} class="dialog wide-dialog" onCancel={(e) => (e.preventDefault(), onClose())}>
      <div class="dialog-body">
        <h2>{t(mode === 'world' ? 'image.titleWorld' : 'image.title', { name: className })}</h2>
        <h3 class="muted small">{t('image.inProject')}</h3>
        <div class="imggrid">
          {mine.length === 0 && <p class="muted small">{t('image.none')}</p>}
          {mine.map((m) => (
            <button type="button" key={m.path} class={m.path === current ? 'imgcard current' : 'imgcard'} title={m.path} onClick={() => onChoose(m.path)}>
              <img src={m.url} alt="" />
              <span>{m.path.replace(/^images\//, '')}</span>
            </button>
          ))}
        </div>
        <h3 class="muted small">{t('image.library')}</h3>
        <div class="chips" role="tablist" aria-label={t('image.library')}>
          {CATEGORIES.map((c) => (
            <button type="button" role="tab" key={c} aria-selected={category === c} onClick={() => setCategory(c)}>
              {t(`image.cat.${c}` as MessageKey)}
            </button>
          ))}
        </div>
        <div class="imggrid" role="tabpanel">
          {shown.map(({ item, url }) => (
            <button type="button" key={item.id} class={`imgcard${item.category === 'backgrounds' ? ' wide' : ''}`} title={t(`image.lib.${item.id}` as MessageKey)} onClick={() => void fromLibrary(item.id)}>
              <img src={url} alt="" />
              <span>{t(`image.lib.${item.id}` as MessageKey)}</span>
            </button>
          ))}
        </div>
        <p class="muted small">{t('image.libraryLicense')}</p>
        <input ref={upload} type="file" accept="image/*" hidden onChange={(e) => e.currentTarget.files?.[0] && void fromFile(e.currentTarget.files[0])} />
        <div class="dialog-buttons">
          <button type="button" onClick={() => setDrawing(true)}>
            {t('image.draw')}
          </button>
          <button type="button" onClick={() => void askUpload()}>
            {t('image.upload')}
          </button>
          <button type="button" onClick={onClose}>
            {t('dialog.cancel')}
          </button>
        </div>
      </div>
      {drawing && <PixelEditor onSave={(png) => (setDrawing(false), void saveDrawing(png))} onClose={() => setDrawing(false)} />}
    </dialog>
  )
}

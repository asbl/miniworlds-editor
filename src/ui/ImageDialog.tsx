import { useEffect, useRef, useState } from 'preact/hooks'
import { LIBRARY, libraryBytes, libraryDataUrl, mimeOf } from '../greenfoot/imageLibrary'
import { t, useLang } from '../i18n'
import { isImagePath } from '../project/search'
import { uniquePath, type Fs } from '../workspace'

interface Props {
  fs: Fs
  className: string
  current: string | null
  /** The user picked (or added) an image of the project. */
  onChoose: (path: string) => void
  onClose: () => void
}

/** "Set image …": pick from the project, from the built-in library, or upload. New images go to images/. */
export function ImageDialog({ fs, className, current, onChoose, onClose }: Props) {
  useLang()
  const ref = useRef<HTMLDialogElement>(null)
  const upload = useRef<HTMLInputElement>(null)
  const [mine, setMine] = useState<{ path: string; url: string }[]>([])

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
    onChoose(path)
  }

  async function fromFile(file: File) {
    const base = file.name.replace(/[^\w\-.]+/g, '_')
    const path = await uniquePath(fs, `images/${base}`)
    await fs.write(path, new Uint8Array(await file.arrayBuffer()))
    onChoose(path)
  }

  return (
    <dialog ref={ref} class="dialog wide-dialog" onCancel={(e) => (e.preventDefault(), onClose())}>
      <div class="dialog-body">
        <h2>{t('image.title', { name: className })}</h2>
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
        <div class="imggrid">
          {LIBRARY.map((item) => (
            <button type="button" key={item.id} class="imgcard" title={t(`image.lib.${item.id}` as const)} onClick={() => void fromLibrary(item.id)}>
              <img src={libraryDataUrl(item)} alt="" />
              <span>{t(`image.lib.${item.id}` as const)}</span>
            </button>
          ))}
        </div>
        <input ref={upload} type="file" accept="image/*" hidden onChange={(e) => e.currentTarget.files?.[0] && void fromFile(e.currentTarget.files[0])} />
        <div class="dialog-buttons">
          <button type="button" onClick={() => upload.current?.click()}>
            {t('image.upload')}
          </button>
          <button type="button" onClick={onClose}>
            {t('dialog.cancel')}
          </button>
        </div>
      </div>
    </dialog>
  )
}

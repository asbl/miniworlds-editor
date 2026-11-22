import { useEffect, useRef, useState } from 'preact/hooks'
import { t, useLang } from '../i18n'
import { mimeOf } from '../miniworlds/imageLibrary'
import type { ImageSource } from '../miniworlds/provenance'
import { fpsToSpeed, speedToFps, type Costumes } from '../project/classCostumes'
import type { Fs } from '../workspace'
import { ImageDialog } from './ImageDialog'

interface Props {
  fs: Fs
  className: string
  initial: Costumes
  /** A picture was added from outside the project (library, upload, drawing): where it came from. */
  onSource: (path: string, source: ImageSource) => void
  onApply: (costumes: Costumes) => void
  onClose: () => void
}

const MAX_FPS = 30

/** "Costumes and animation": the pictures of an actor in order, a live preview, the speed; writes the code on OK. */
export function CostumeDialog({ fs, className, initial, onSource, onApply, onClose }: Props) {
  useLang()
  const ref = useRef<HTMLDialogElement>(null)
  const [frames, setFrames] = useState<string[]>(initial.frames)
  const [fps, setFps] = useState(initial.speed ? Math.min(MAX_FPS, speedToFps(initial.speed)) : 6)
  const [loop, setLoop] = useState(initial.loop)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const urlsRef = useRef(urls)
  urlsRef.current = urls
  const [shown, setShown] = useState(0)
  const [adding, setAdding] = useState<number | 'append' | null>(null)

  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal()
  }, [])

  // thumbnails of the frames (loaded once per path)
  useEffect(() => {
    let stale = false
    const made: string[] = []
    void (async () => {
      const next: Record<string, string> = {}
      for (const path of frames) {
        if (next[path]) continue
        if (urls[path]) {
          next[path] = urls[path] as string
          continue
        }
        if (!(await fs.exists(path))) continue
        const url = URL.createObjectURL(new Blob([(await fs.readBytes(path)) as BlobPart], { type: mimeOf(path) }))
        made.push(url)
        next[path] = url
      }
      if (!stale) setUrls((old) => ({ ...old, ...next }))
    })()
    return () => {
      stale = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frames, fs])
  useEffect(() => () => Object.values(urlsRef.current).forEach((u) => URL.revokeObjectURL(u)), [])

  // the preview: one frame after the other, at the chosen speed
  useEffect(() => {
    if (frames.length < 2) return void setShown(0)
    const timer = setInterval(() => setShown((n) => (loop ? (n + 1) % frames.length : Math.min(n + 1, frames.length - 1))), 1000 / fps)
    return () => clearInterval(timer)
  }, [frames.length, fps, loop])

  const move = (i: number, by: number) =>
    setFrames((list) => {
      const j = i + by
      if (j < 0 || j >= list.length) return list
      const copy = [...list]
      ;[copy[i], copy[j]] = [copy[j] as string, copy[i] as string]
      return copy
    })
  const remove = (i: number) => setFrames((list) => list.filter((_, k) => k !== i))
  const current = frames[Math.min(shown, frames.length - 1)]

  return (
    <dialog ref={ref} class="dialog wide-dialog appearance-dialog" aria-labelledby="appearance-title" onCancel={(e) => (e.preventDefault(), onClose())}>
      <div class="dialog-body">
        <h2 id="appearance-title">{t('costume.title', { name: className })}</h2>
        <div class="costume-main">
          <div class="costume-preview" aria-label={t('costume.preview')}>
            {current && urls[current] ? <img src={urls[current]} alt="" /> : <span class="muted small">{t('costume.none')}</span>}
          </div>
          <ol class="costume-strip" aria-label={t('costume.frames')}>
            {frames.map((path, i) => (
              <li key={`${path}-${i}`} class={i === Math.min(shown, frames.length - 1) && frames.length > 1 ? 'costume-frame current' : 'costume-frame'}>
                <button type="button" class="costume-change" aria-label={t('costume.change', { n: i + 1 })} onClick={() => setAdding(i)}>
                  {urls[path] ? <img src={urls[path]} alt="" /> : <span class="missing">?</span>}
                </button>
                <span class="small muted">{i + 1}</span>
                <span class="costume-actions">
                  {frames.length > 1 && <>
                  <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('costume.earlier')} title={t('costume.earlier')}>
                    ◀
                  </button>
                  <button type="button" disabled={i === frames.length - 1} onClick={() => move(i, 1)} aria-label={t('costume.later')} title={t('costume.later')}>
                    ▶
                  </button>
                  </>}
                  <button type="button" onClick={() => remove(i)} aria-label={t('costume.remove')} title={t('costume.remove')}>
                    ✕
                  </button>
                </span>
              </li>
            ))}
            <li class="costume-add">
              <button type="button" onClick={() => setAdding('append')}>
                ＋ {t('costume.add')}
              </button>
            </li>
          </ol>
        </div>
        {frames.length > 1 && <div class="costume-options">
          <label class="costume-speed">
            <span>{t('costume.speed')}</span>
            <input type="range" min={1} max={MAX_FPS} value={fps} disabled={frames.length < 2} onInput={(e) => setFps(Number(e.currentTarget.value))} aria-valuetext={t('costume.fps', { n: fps })} />
            <output>{t('costume.fps', { n: fps })}</output>
          </label>
          <label class="inline">
            <input type="checkbox" checked={loop} disabled={frames.length < 2} onChange={(e) => setLoop(e.currentTarget.checked)} />
            <span>{t('costume.loop')}</span>
          </label>
        </div>}
        {frames.length > 1 && <p class="muted small">{t('costume.sameSize')}</p>}
        <div class="dialog-buttons">
          <button type="button" onClick={onClose}>
            {t('dialog.cancel')}
          </button>
          <button type="button" class="primary" disabled={frames.length === 0} onClick={() => onApply({ frames, speed: frames.length > 1 ? fpsToSpeed(fps) : null, loop })}>
            {t(frames.length > 1 ? 'costume.applyAnimation' : 'costume.applyImage')}
          </button>
        </div>
      </div>
      {adding !== null && (
        <ImageDialog
          fs={fs}
          className={className}
          current={typeof adding === 'number' ? frames[adding] ?? null : null}
          onChoose={(path, source) => {
            setAdding(null)
            if (source) onSource(path, source)
            setFrames((list) => adding === 'append' ? [...list, path] : list.map((old, i) => i === adding ? path : old))
          }}
          onClose={() => setAdding(null)}
        />
      )}
    </dialog>
  )
}

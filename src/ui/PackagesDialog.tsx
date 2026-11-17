import { useEffect, useRef, useState } from 'preact/hooks'
import { t, useLang } from '../i18n'
import { cleanRequirements } from '../project/settings'

interface Props {
  packages: readonly string[]
  /** Installs into the Python environment; resolves with the outcome. */
  install: (requirement: string) => Promise<{ ok: boolean; error?: string }>
  onChange: (packages: string[]) => void
  onClose: () => void
}

export function PackagesDialog({ packages, install, onChange, onClose }: Props) {
  useLang()
  const ref = useRef<HTMLDialogElement>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal()
  }, [])

  async function add(event: Event) {
    event.preventDefault()
    const requirement = text.trim()
    if (requirement === '' || busy) return
    setError(null)
    setBusy(requirement)
    const result = await install(requirement)
    setBusy(null)
    if (result.ok) {
      onChange(cleanRequirements([...packages, requirement]))
      setText('')
    } else {
      setError(t('packages.failed', { reason: (result.error ?? '').split('\n').filter(Boolean).at(-1) ?? '' }))
    }
  }

  return (
    <dialog ref={ref} class="dialog" onCancel={(e) => (e.preventDefault(), onClose())}>
      <form onSubmit={(e) => void add(e)}>
        <h2>{t('packages.title')}</h2>
        <p class="dialog-message">{t('packages.hint')}</p>
        <ul class="packages">
          {packages.length === 0 && <li class="muted">{t('packages.none')}</li>}
          {packages.map((p) => (
            <li key={p}>
              <code>{p}</code>
              <button type="button" aria-label={t('packages.remove', { name: p })} title={t('packages.remove', { name: p })} onClick={() => onChange(packages.filter((x) => x !== p))}>
                ×
              </button>
            </li>
          ))}
        </ul>
        <div class="field">
          <label>
            <span>{t('packages.add')}</span>
            <input type="text" value={text} placeholder="requests" disabled={busy !== null} onInput={(e) => (setText(e.currentTarget.value), setError(null))} />
          </label>
        </div>
        {busy && (
          <p class="dialog-message" role="status">
            {t('packages.installing', { name: busy })}
          </p>
        )}
        {error && (
          <p class="dialog-error" role="alert">
            {error}
          </p>
        )}
        <div class="dialog-buttons">
          <button type="button" onClick={onClose}>
            {t('dialog.close')}
          </button>
          <button type="submit" class="primary" disabled={busy !== null || text.trim() === ''}>
            {t('packages.install')}
          </button>
        </div>
      </form>
    </dialog>
  )
}

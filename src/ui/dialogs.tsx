import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { t, useLang, type MessageKey } from '../i18n'

export type Field =
  | { kind: 'text'; key: string; label: string; initial?: string; placeholder?: string }
  | { kind: 'radio'; key: string; label: string; initial: string; options: { value: string; label: string; hint?: string }[] }
  | { kind: 'checkbox'; key: string; label: string; initial: boolean }
  | { kind: 'select'; key: string; label: string; initial: string; options: { value: string; label: string }[] }

export type Values = Record<string, string | boolean>

export interface DialogSpec {
  title: string
  /** Plain explanatory text above the fields (also the whole body of a confirmation). */
  message?: string
  fields?: Field[]
  submit?: MessageKey
  danger?: boolean
  /** Hide the cancel button (information only). */
  info?: boolean
  /** Free content below the message (e.g. a table). */
  body?: ComponentChildren
  /** Extra buttons left of Cancel/OK; they do not close the dialog unless `close` is set. */
  extra?: { label: string; onClick: () => void; close?: boolean }[]
  /** Return an error text to keep the dialog open. */
  validate?: (values: Values) => string | null | Promise<string | null>
}

interface Pending {
  id: number
  spec: DialogSpec
  resolve: (values: Values | null) => void
}

let setCurrent: ((p: Pending | null) => void) | null = null
let seq = 0

/** Opens a modal dialog; resolves with the field values, or null when cancelled. Own dialogs because iframes may block window.prompt. */
export function openDialog(spec: DialogSpec): Promise<Values | null> {
  return new Promise((resolve) => {
    if (!setCurrent) return resolve(null)
    setCurrent({ id: ++seq, spec, resolve })
  })
}

export const confirmDialog = async (title: string, message: string, danger = true): Promise<boolean> =>
  (await openDialog({ title, message, danger, submit: danger ? 'dialog.delete' : 'dialog.ok' })) !== null

export const infoDialog = async (title: string, message: string): Promise<void> => void (await openDialog({ title, message, info: true }))

export function DialogHost() {
  useLang()
  const [pending, setPending] = useState<Pending | null>(null)
  useEffect(() => {
    setCurrent = setPending
    return () => {
      setCurrent = null
    }
  }, [])
  return pending ? <DialogView key={pending.id} pending={pending} close={() => setPending(null)} /> : null
}

function DialogView({ pending, close }: { pending: Pending; close: () => void }) {
  const { spec, resolve } = pending
  const ref = useRef<HTMLDialogElement>(null)
  const [values, setValues] = useState<Values>(() =>
    Object.fromEntries((spec.fields ?? []).map((f) => [f.key, f.kind === 'text' ? (f.initial ?? '') : f.initial])),
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
    dialog?.querySelector<HTMLInputElement>('input[type=text]')?.select()
  }, [])

  const finish = (result: Values | null) => {
    resolve(result)
    close()
  }

  async function submit(event: Event) {
    event.preventDefault()
    const problem = spec.validate ? await spec.validate(values) : null
    if (problem) setError(problem)
    else finish(values)
  }

  const set = (key: string, value: string | boolean) => {
    setError(null)
    setValues((v) => ({ ...v, [key]: value }))
  }

  return (
    <dialog ref={ref} class="dialog" onCancel={(e) => (e.preventDefault(), finish(null))}>
      <form onSubmit={(e) => void submit(e)}>
        <h2>{spec.title}</h2>
        {spec.message && <p class="dialog-message">{spec.message}</p>}
        {spec.body}
        {(spec.fields ?? []).map((field) => (
          <div class="field" key={field.key}>
            {field.kind === 'text' && (
              <label>
                <span>{field.label}</span>
                <input type="text" value={values[field.key] as string} placeholder={field.placeholder} autocomplete="off" spellcheck={false} onInput={(e) => set(field.key, e.currentTarget.value)} />
              </label>
            )}
            {field.kind === 'checkbox' && (
              <label class="inline">
                <input type="checkbox" checked={values[field.key] as boolean} onChange={(e) => set(field.key, e.currentTarget.checked)} />
                <span>{field.label}</span>
              </label>
            )}
            {field.kind === 'select' && (
              <label>
                <span>{field.label}</span>
                <select value={values[field.key] as string} onChange={(e) => set(field.key, e.currentTarget.value)}>
                  {field.options.map((o) => (
                    <option value={o.value} key={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {field.kind === 'radio' && (
              <fieldset>
                <legend>{field.label}</legend>
                {field.options.map((o) => (
                  <label class="inline radio" key={o.value}>
                    <input
                      type="radio"
                      name={field.key}
                      checked={values[field.key] === o.value}
                      onChange={() => set(field.key, o.value)}
                    />
                    <span>
                      {o.label}
                      {o.hint && <small>{o.hint}</small>}
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
          </div>
        ))}
        {error && (
          <p class="dialog-error" role="alert">
            {error}
          </p>
        )}
        <div class="dialog-buttons">
          {(spec.extra ?? []).map((x) => (
            <button type="button" key={x.label} onClick={() => (x.onClick(), x.close && finish(null))}>
              {x.label}
            </button>
          ))}
          {!spec.info && (
            <button type="button" onClick={() => finish(null)}>
              {t('dialog.cancel')}
            </button>
          )}
          <button type="submit" class={spec.danger ? 'primary danger' : 'primary'}>
            {t(spec.submit ?? 'dialog.ok')}
          </button>
        </div>
      </form>
    </dialog>
  )
}

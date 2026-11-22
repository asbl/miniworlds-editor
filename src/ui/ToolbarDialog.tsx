import { useEffect, useRef, useState } from 'preact/hooks'
import { t, useLang, type MessageKey } from '../i18n'
import { validName, type Dock, type ToolbarSpec, type WidgetSpec } from '../project/classToolbar'

interface Props {
  className: string
  initial: ToolbarSpec | null
  /** The class has an `on_message` already: no second one is written. */
  hasHandler: boolean
  onApply: (spec: ToolbarSpec, handler: boolean) => void
  onClose: () => void
}

type Kind = WidgetSpec['kind']
const KINDS: Kind[] = ['button', 'label', 'counter']

/** A new widget with a text that is useful at once. */
function fresh(kind: Kind, taken: Set<string>): WidgetSpec {
  if (kind === 'button') return { kind, text: t('toolbar.newButton') }
  if (kind === 'label') return { kind, text: t('toolbar.newLabel') }
  let n = 1
  while (taken.has(`punkte${n === 1 ? '' : n}`)) n++
  return { kind, text: t('toolbar.newCounter'), name: `punkte${n === 1 ? '' : n}` }
}

const DRAG_TYPE = 'text/plain'

/**
 * "Build a control panel": buttons, labels and counters are dragged (or clicked) into a mock of the panel next to the
 * world; the order and texts are set there. OK writes the code into the world class.
 */
export function ToolbarDialog({ className, initial, hasHandler, onApply, onClose }: Props) {
  useLang()
  const ref = useRef<HTMLDialogElement>(null)
  const [dock, setDock] = useState<Dock>(initial?.dock ?? 'right')
  const [widgets, setWidgets] = useState<WidgetSpec[]>(initial?.widgets ?? [])
  const [handler, setHandler] = useState(!hasHandler)
  const [selected, setSelected] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)

  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal()
  }, [])

  const names = () => new Set(widgets.flatMap((w) => (w.kind === 'counter' ? [w.name] : [])))
  const insert = (widget: WidgetSpec, at: number) => {
    setWidgets((list) => [...list.slice(0, at), widget, ...list.slice(at)])
    setSelected(at)
  }
  const update = (i: number, patch: Partial<WidgetSpec>) => setWidgets((list) => list.map((w, k) => (k === i ? ({ ...w, ...patch } as WidgetSpec) : w)))
  const remove = (i: number) => {
    setWidgets((list) => list.filter((_, k) => k !== i))
    setSelected(null)
  }
  const move = (from: number, to: number) => {
    setSelected(to)
    setWidgets((list) => {
      if (from === to || from < 0 || from >= list.length) return list
      const copy = [...list]
      const [item] = copy.splice(from, 1)
      copy.splice(Math.min(to, copy.length), 0, item as WidgetSpec)
      return copy
    })
  }

  function drop(event: DragEvent, at: number) {
    event.preventDefault()
    event.stopPropagation()
    setOver(null)
    const data = event.dataTransfer?.getData(DRAG_TYPE) ?? ''
    if (data.startsWith('new:')) insert(fresh(data.slice(4) as Kind, names()), at)
    else if (data.startsWith('move:')) move(Number(data.slice(5)), at > Number(data.slice(5)) ? at - 1 : at)
  }

  const counterNames = widgets.flatMap((w) => (w.kind === 'counter' ? [w.name] : []))
  const nameProblem = counterNames.some((n) => !validName(n)) ? t('toolbar.badName') : new Set(counterNames).size !== counterNames.length ? t('toolbar.dupName') : null
  const selectedWidget = selected === null ? undefined : widgets[selected]
  const vertical = dock !== 'bottom'

  return (
    <dialog ref={ref} class="dialog wide-dialog" aria-labelledby="toolbar-title" onCancel={(e) => (e.preventDefault(), onClose())}>
      <div class="dialog-body">
        <h2 id="toolbar-title">{t('toolbar.title', { name: className })}</h2>
        <div class="toolbar-builder">
          <div class="toolbar-palette" role="group" aria-label={t('toolbar.palette')}>
            {KINDS.map((kind) => (
              <button
                type="button"
                key={kind}
                draggable
                onDragStart={(e) => e.dataTransfer?.setData(DRAG_TYPE, `new:${kind}`)}
                onClick={() => insert(fresh(kind, names()), widgets.length)}
                title={t('toolbar.addHint')}
              >
                ＋ {t(`toolbar.kind.${kind}` as MessageKey)}
              </button>
            ))}
          </div>
          <div class={`toolbar-mock dock-${dock}`} aria-label={t('toolbar.mock')}>
            <div class="toolbar-world muted small">{t('toolbar.world', { name: className })}</div>
            <div
              class={over === widgets.length ? 'toolbar-panel over' : 'toolbar-panel'}
              onDragOver={(e) => (e.preventDefault(), setOver(widgets.length))}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => drop(e, widgets.length)}
            >
              {widgets.length === 0 && <p class="muted small toolbar-empty">{t('toolbar.empty')}</p>}
              <ul class={vertical ? 'toolbar-items' : 'toolbar-items row'}>
                {widgets.map((w, i) => (
                  <li
                    key={i}
                    class={over === i ? 'toolbar-item over' : 'toolbar-item'}
                    onClickCapture={() => setSelected(i)}
                    onFocusIn={() => setSelected(i)}
                    draggable
                    onDragStart={(e) => e.dataTransfer?.setData(DRAG_TYPE, `move:${i}`)}
                    onDragOver={(e) => (e.preventDefault(), e.stopPropagation(), setOver(i))}
                    onDrop={(e) => drop(e, i)}
                  >
                    <span class="toolbar-kind small muted">{t(`toolbar.kind.${w.kind}` as MessageKey)}</span>
                    <input type="text" value={w.text} aria-label={t('toolbar.text')} onInput={(e) => update(i, { text: e.currentTarget.value })} />
                    {w.kind === 'counter' && <input type="text" class="toolbar-name" value={w.name} aria-label={t('toolbar.counterName')} title={t('toolbar.counterName')} onInput={(e) => update(i, { name: e.currentTarget.value })} />}
                    <span class="toolbar-actions">
                      <button type="button" disabled={i === 0} onClick={() => move(i, i - 1)} aria-label={t('toolbar.earlier')} title={t('toolbar.earlier')}>
                        {vertical ? '▲' : '◀'}
                      </button>
                      <button type="button" disabled={i === widgets.length - 1} onClick={() => move(i, i + 1)} aria-label={t('toolbar.later')} title={t('toolbar.later')}>
                        {vertical ? '▼' : '▶'}
                      </button>
                      <button type="button" onClick={() => remove(i)} aria-label={t('toolbar.remove')} title={t('toolbar.remove')}>
                        ✕
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
        <div class="toolbar-options">
          <label>
            <span>{t('toolbar.dock')}</span>{' '}
            <select value={dock} onChange={(e) => setDock(e.currentTarget.value as Dock)}>
              {(['right', 'left', 'bottom'] as Dock[]).map((d) => (
                <option key={d} value={d}>
                  {t(`toolbar.dock.${d}` as MessageKey)}
                </option>
              ))}
            </select>
          </label>
          <label class="inline">
            <input type="checkbox" checked={handler && !hasHandler} disabled={hasHandler || !widgets.some((w) => w.kind === 'button')} onChange={(e) => setHandler(e.currentTarget.checked)} />
            <span>{hasHandler ? t('toolbar.handlerExists') : t('toolbar.handler')}</span>
          </label>
        </div>
        {nameProblem && <p class="error-text small">{nameProblem}</p>}
        {selectedWidget?.kind === 'counter' && <p class="muted small">{t('toolbar.counterHint', { name: selectedWidget.name })}</p>}
        <div class="dialog-buttons">
          <button type="button" onClick={onClose}>
            {t('dialog.cancel')}
          </button>
          <button type="button" class="primary" disabled={widgets.length === 0 || nameProblem !== null} onClick={() => onApply({ dock, widgets }, handler && !hasHandler)}>
            {t(initial ? 'toolbar.apply' : 'toolbar.insert')}
          </button>
        </div>
      </div>
    </dialog>
  )
}

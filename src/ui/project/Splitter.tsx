import { useRef, useState } from 'preact/hooks'
import { t } from '../../i18n'
import { PANEL_LIMITS, type Panel } from './layout'

interface Props {
  /** The column this handle resizes. The sidebar is to its left, the world to its right. */
  panel: Panel
  value: number
  onResize: (px: number) => void
  onReset: () => void
}

const STEP = 16

/**
 * The drag handle between two columns. Mouse, touch and pen drag it; the keyboard moves it with the arrow keys
 * (Shift for bigger steps), Home or a double click brings the column back to its default width.
 */
export function Splitter({ panel, value, onResize, onReset }: Props) {
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ x: number; width: number } | null>(null)
  const sign = panel === 'sidebar' ? 1 : -1 // dragging right widens the sidebar and narrows the world
  const { min, max } = PANEL_LIMITS[panel]
  /** The column's real width: the stylesheet's default may differ from the fallback (smaller windows have a narrower world). */
  const measure = (splitter: Element): number => {
    const column = (panel === 'sidebar' ? splitter.previousElementSibling : splitter.nextElementSibling) as HTMLElement | null
    return column?.getBoundingClientRect().width ?? value
  }
  const label = t(panel === 'sidebar' ? 'layout.resizeSidebar' : 'layout.resizeWorld')

  return (
    <div
      class={dragging ? 'splitter dragging' : 'splitter'}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      title={t('layout.splitterHint')}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        drag.current = { x: e.clientX, width: measure(e.currentTarget) }
        e.currentTarget.setPointerCapture(e.pointerId)
        setDragging(true)
        e.preventDefault()
      }}
      onPointerMove={(e) => {
        if (drag.current) onResize(drag.current.width + sign * (e.clientX - drag.current.x))
      }}
      onPointerUp={() => ((drag.current = null), setDragging(false))}
      onPointerCancel={() => ((drag.current = null), setDragging(false))}
      onDblClick={onReset}
      onKeyDown={(e) => {
        const step = e.shiftKey ? STEP * 4 : STEP
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault()
          e.stopPropagation()
          onResize(measure(e.currentTarget) + sign * (e.key === 'ArrowRight' ? step : -step))
        } else if (e.key === 'Home') {
          e.preventDefault()
          onReset()
        }
      }}
    />
  )
}

import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { clampWidth, effectiveWidths, loadWidths, PANEL_LIMITS, saveWidths, widthStyle, type Panel, type PanelWidths } from './layout'

/** The widths of the side columns: chosen by dragging a splitter, remembered in this browser. */
export function usePanelWidths() {
  const body = useRef<HTMLElement>(null)
  const [widths, setWidths] = useState<PanelWidths>(loadWidths)
  const [bodyWidth, setBodyWidth] = useState(0)
  useEffect(() => {
    const el = body.current
    if (!el || typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver(() => setBodyWidth(el.clientWidth))
    observer.observe(el)
    setBodyWidth(el.clientWidth)
    return () => observer.disconnect()
  }, [])
  const first = useRef(true)
  const latest = useRef(widths)
  latest.current = widths
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const timer = setTimeout(() => saveWidths(widths), 300)
    return () => clearTimeout(timer)
  }, [widths])
  // a reload right after dragging must not lose the choice
  useEffect(() => {
    const flush = () => saveWidths(latest.current)
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [])

  const resize = useCallback((panel: Panel, px: number) => {
    const el = body.current
    const other = el?.querySelector<HTMLElement>(panel === 'sidebar' ? '.world-panel' : '.sidebar')
    const next = clampWidth(panel, px, el?.clientWidth ?? 1600, other?.getBoundingClientRect().width ?? 0)
    setWidths((prev) => (prev[panel] === next ? prev : { ...prev, [panel]: next }))
  }, [])
  const reset = useCallback((panel: Panel) => setWidths((prev) => ({ ...prev, [panel]: null })), [])
  const shown = effectiveWidths(widths, bodyWidth)
  const current = (panel: Panel) => shown[panel] ?? PANEL_LIMITS[panel].fallback
  return { body, style: widthStyle(shown), resize, reset, current }
}

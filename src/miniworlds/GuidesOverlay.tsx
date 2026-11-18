import { useEffect, useRef } from 'preact/hooks'
import { drawGuides, type Guides } from './guides'
import type { ActorInfo } from './scenario'

/** Transparent layer over the world canvas; redraws with every new actor list and size change. */
export function GuidesOverlay({ canvas, guides, actors, tick }: { canvas: HTMLCanvasElement; guides: Guides; actors: readonly ActorInfo[]; tick: number }) {
  const layer = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const el = layer.current
    const g = el?.getContext('2d')
    if (!el || !g) return
    const rect = canvas.getBoundingClientRect()
    const [width, height] = [Math.max(1, Math.round(rect.width)), Math.max(1, Math.round(rect.height))]
    const ratio = window.devicePixelRatio || 1
    if (el.width !== Math.round(width * ratio) || el.height !== Math.round(height * ratio)) {
      el.width = Math.round(width * ratio)
      el.height = Math.round(height * ratio)
    }
    el.style.width = `${width}px`
    el.style.height = `${height}px`
    g.setTransform(ratio, 0, 0, ratio, 0, 0)
    drawGuides(g, width, height, canvas.width > 0 ? width / canvas.width : 1, guides, actors)
  }, [canvas, guides, actors, tick])

  return <canvas ref={layer} class="guides-layer" aria-hidden="true" />
}

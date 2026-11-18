import { canvasPoint } from '../runtime/input'
import type { MiniworldsController } from './controller'

export type WorldPoint = { x: number; y: number }

/**
 * Editor interactions on the world canvas while the world is paused: place, select, drag, context menu, Esc.
 * The program does not see these mouse events (the input layer is gated with `controller.interactive`).
 */
export function attachWorldTools(
  canvas: HTMLCanvasElement,
  controller: MiniworldsController,
  onContextMenu: (event: MouseEvent, point: WorldPoint) => void,
): () => void {
  const point = (e: MouseEvent): WorldPoint => canvasPoint(e, canvas.getBoundingClientRect(), canvas)

  const onDown = (e: PointerEvent) => {
    if (!controller.interactive || e.button !== 0) return
    e.preventDefault()
    canvas.focus()
    canvas.setPointerCapture?.(e.pointerId)
    const p = point(e)
    void controller.pointerDown(p.x, p.y, e.shiftKey)
  }
  const onMove = (e: PointerEvent) => {
    const p = point(e)
    controller.pointerMove(p.x, p.y)
  }
  const onUp = () => void controller.pointerUp()
  const onContext = (e: MouseEvent) => {
    if (!controller.interactive) return
    e.preventDefault()
    onContextMenu(e, point(e))
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && controller.state.armed) {
      e.stopPropagation()
      void controller.arm(null)
    }
  }

  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('contextmenu', onContext)
  canvas.addEventListener('keydown', onKey)
  return () => {
    canvas.removeEventListener('pointerdown', onDown)
    canvas.removeEventListener('pointermove', onMove)
    canvas.removeEventListener('pointerup', onUp)
    canvas.removeEventListener('contextmenu', onContext)
    canvas.removeEventListener('keydown', onKey)
  }
}

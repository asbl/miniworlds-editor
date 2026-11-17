import type { InputEvent } from './protocol'
import { toPygameButton, toPygameKey, toPygameMod, toUnicode } from './keymap'

/** Canvas pixel for a pointer position: the element may be displayed smaller or larger than its bitmap. */
export function canvasPoint(
  e: { clientX: number; clientY: number },
  rect: { left: number; top: number; width: number; height: number },
  size: { width: number; height: number },
): { x: number; y: number } {
  const sx = rect.width > 0 ? size.width / rect.width : 1
  const sy = rect.height > 0 ? size.height / rect.height : 1
  return {
    x: Math.max(0, Math.min(size.width - 1, Math.floor((e.clientX - rect.left) * sx))),
    y: Math.max(0, Math.min(size.height - 1, Math.floor((e.clientY - rect.top) * sy))),
  }
}

/** Forwards DOM input of `canvas` to the worker. Returns a function that removes the listeners. */
export function attachInput(canvas: HTMLCanvasElement, send: (event: InputEvent) => void): () => void {
  const point = (e: MouseEvent) => canvasPoint(e, canvas.getBoundingClientRect(), canvas)
  const buttons = (e: MouseEvent) => (e.buttons & 1 ? 1 : 0) | (e.buttons & 4 ? 2 : 0) | (e.buttons & 2 ? 4 : 0)

  const key = (kind: 'keydown' | 'keyup') => (e: KeyboardEvent) => {
    const code = toPygameKey(e)
    if (code === null || e.repeat) return
    // keep arrows/space from scrolling the page while a game has the focus; leave browser shortcuts alone
    if (!e.ctrlKey && !e.metaKey) e.preventDefault()
    send({ kind, key: code, mod: toPygameMod(e), unicode: toUnicode(e) })
  }
  const onKeyDown = key('keydown')
  const onKeyUp = key('keyup')
  const onDown = (e: PointerEvent) => {
    canvas.focus()
    canvas.setPointerCapture?.(e.pointerId) // so the button release is seen even outside the canvas
    send({ kind: 'mousedown', ...point(e), button: toPygameButton(e.button) })
  }
  const onUp = (e: PointerEvent) => send({ kind: 'mouseup', ...point(e), button: toPygameButton(e.button) })
  const onMove = (e: PointerEvent) => send({ kind: 'mousemove', ...point(e), buttons: buttons(e) })
  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    send({ kind: 'wheel', dx: Math.sign(e.deltaX), dy: -Math.sign(e.deltaY) })
  }
  const noMenu = (e: Event) => e.preventDefault()

  canvas.addEventListener('keydown', onKeyDown)
  canvas.addEventListener('keyup', onKeyUp)
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.addEventListener('contextmenu', noMenu)
  return () => {
    canvas.removeEventListener('keydown', onKeyDown)
    canvas.removeEventListener('keyup', onKeyUp)
    canvas.removeEventListener('pointerdown', onDown)
    canvas.removeEventListener('pointerup', onUp)
    canvas.removeEventListener('pointermove', onMove)
    canvas.removeEventListener('wheel', onWheel)
    canvas.removeEventListener('contextmenu', noMenu)
  }
}

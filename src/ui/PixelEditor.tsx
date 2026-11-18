import { useEffect, useRef, useState } from 'preact/hooks'
import { t, useLang } from '../i18n'
import { PALETTE, PixelGrid, type Cell } from './pixelGrid'

type Tool = 'pencil' | 'eraser' | 'fill'
const VIEW = 320
const EXPORT = 64

/** PNG bytes of the grid, scaled up by a whole factor (crisp squares, not smoothed). */
export function gridToPng(grid: PixelGrid): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = EXPORT
  const g = canvas.getContext('2d') as CanvasRenderingContext2D
  const cell = EXPORT / grid.size
  grid.cells.forEach((color, i) => {
    if (!color) return
    g.fillStyle = color
    g.fillRect((i % grid.size) * cell, Math.floor(i / grid.size) * cell, cell, cell)
  })
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? void blob.arrayBuffer().then((b) => resolve(new Uint8Array(b))) : reject(new Error('toBlob failed'))), 'image/png'))
}

/** A small drawing tool for actor pictures: 16×16 or 32×32 squares, 16 colours, pencil, eraser, bucket, undo. */
export function PixelEditor({ onSave, onClose }: { onSave: (png: Uint8Array) => void; onClose: () => void }) {
  useLang()
  const ref = useRef<HTMLDialogElement>(null)
  const view = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState(16)
  const [grid, setGrid] = useState(() => new PixelGrid(16))
  const [tool, setTool] = useState<Tool>('pencil')
  const [color, setColor] = useState(PALETTE[4] as string)
  const [, redraw] = useState(0)
  const last = useRef<[number, number] | null>(null)

  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal()
  }, [])

  useEffect(() => {
    const g = view.current?.getContext('2d')
    if (!g) return
    const cell = VIEW / size
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        g.fillStyle = (x + y) % 2 ? '#e8eaee' : '#f8f9fb' // checkerboard = transparent
        g.fillRect(x * cell, y * cell, cell, cell)
        const c = grid.get(x, y)
        if (c) {
          g.fillStyle = c
          g.fillRect(x * cell, y * cell, cell, cell)
        }
      }
    }
  })

  const at = (e: PointerEvent): [number, number] => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return [Math.floor(((e.clientX - rect.left) / rect.width) * size), Math.floor(((e.clientY - rect.top) / rect.height) * size)]
  }
  const paint = (x: number, y: number, from: [number, number] | null) => {
    const value: Cell = tool === 'eraser' ? null : color
    const changed = tool === 'fill' ? grid.fill(x, y, value) : grid.line(from?.[0] ?? x, from?.[1] ?? y, x, y, value)
    if (changed) redraw((n) => n + 1)
  }

  function changeSize(next: number) {
    setSize(next)
    setGrid(new PixelGrid(next))
  }

  return (
    <dialog ref={ref} class="dialog pixel-dialog" onCancel={(e) => (e.preventDefault(), onClose())}>
      <div class="dialog-body">
        <h2>{t('draw.title')}</h2>
        <div class="pixel-tools" role="toolbar" aria-label={t('draw.tools')}>
          {(['pencil', 'eraser', 'fill'] as Tool[]).map((name) => (
            <button type="button" key={name} aria-pressed={tool === name} onClick={() => setTool(name)}>
              {t(`draw.${name}` as 'draw.pencil')}
            </button>
          ))}
          <button type="button" onClick={() => grid.undo() && redraw((n) => n + 1)}>
            {t('draw.undo')}
          </button>
          <button type="button" onClick={() => (grid.mark(), grid.clear(), redraw((n) => n + 1))}>
            {t('draw.clear')}
          </button>
          <label class="pixel-size">
            {t('draw.size')}
            <select value={size} onChange={(e) => changeSize(Number(e.currentTarget.value))}>
              <option value={16}>16 × 16</option>
              <option value={32}>32 × 32</option>
            </select>
          </label>
        </div>
        <canvas
          ref={view}
          class="pixel-canvas"
          width={VIEW}
          height={VIEW}
          aria-label={t('draw.canvas')}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture?.(e.pointerId)
            grid.mark()
            const [x, y] = at(e)
            last.current = tool === 'fill' ? null : [x, y]
            paint(x, y, null)
          }}
          onPointerMove={(e) => {
            if (!last.current) return
            const [x, y] = at(e)
            paint(x, y, last.current)
            last.current = [x, y]
          }}
          onPointerUp={() => (last.current = null)}
          onPointerCancel={() => (last.current = null)}
        />
        <div class="pixel-palette" role="group" aria-label={t('draw.colors')}>
          {PALETTE.map((c) => (
            <button
              type="button"
              key={c}
              class="swatch"
              style={{ background: c }}
              aria-label={c}
              aria-pressed={tool !== 'eraser' && color === c}
              onClick={() => (setColor(c), tool === 'eraser' && setTool('pencil'))}
            />
          ))}
        </div>
        <div class="dialog-buttons">
          <button type="button" class="primary" disabled={grid.isBlank()} title={grid.isBlank() ? t('draw.blank') : undefined} onClick={() => void gridToPng(grid).then(onSave)}>
            {t('draw.save')}
          </button>
          <button type="button" onClick={onClose}>
            {t('dialog.cancel')}
          </button>
        </div>
      </div>
    </dialog>
  )
}

import type { ActorInfo } from './scenario'

/** The helper lines on top of the world: a coordinate grid, each actor's direction, each actor's box. */
export interface Guides {
  coords: boolean
  direction: boolean
  boxes: boolean
}
export const NO_GUIDES: Guides = { coords: false, direction: false, boxes: false }
export const anyGuides = (g: Guides) => g.coords || g.direction || g.boxes

const STORAGE_KEY = 'miniworlds-editor.guides'

export function loadGuides(storage: Pick<Storage, 'getItem'> | null = safeStorage()): Guides {
  try {
    const raw = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null') as Partial<Guides> | null
    return { coords: raw?.coords === true, direction: raw?.direction === true, boxes: raw?.boxes === true }
  } catch {
    return NO_GUIDES
  }
}

export function saveGuides(guides: Guides, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(guides))
  } catch {
    /* private mode: the choice just does not persist */
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** Distance between grid lines in world pixels: roughly one line per 50 screen pixels at least. */
export function gridStep(scale: number): number {
  const steps = [10, 20, 50, 100, 200, 500, 1000]
  return steps.find((s) => s * scale >= 40) ?? 1000
}

/** Scratch-style direction (0 = up, 90 = right) as a unit vector in screen coordinates (y points down). */
export function directionVector(direction: number): [number, number] {
  const radians = (direction * Math.PI) / 180
  return [Math.sin(radians), -Math.cos(radians)]
}

/**
 * Draws the guides into `g`. The overlay has the displayed size of the world (`width`×`height` CSS pixels); `scale` is
 * displayed pixels per world pixel.
 */
export function drawGuides(g: CanvasRenderingContext2D, width: number, height: number, scale: number, guides: Guides, actors: readonly ActorInfo[]): void {
  g.clearRect(0, 0, width, height)
  g.lineWidth = 1
  g.font = '11px system-ui, sans-serif'
  g.textBaseline = 'top'

  if (guides.coords) {
    const step = gridStep(scale)
    g.strokeStyle = 'rgba(255,255,255,0.28)'
    g.fillStyle = 'rgba(255,255,255,0.95)'
    const label = (text: string, x: number, y: number) => {
      const w = g.measureText(text).width
      g.save()
      g.fillStyle = 'rgba(0,0,0,0.55)'
      g.fillRect(x - 2, y - 1, w + 4, 14)
      g.restore()
      g.fillText(text, x, y)
    }
    for (let wx = 0; wx * scale <= width; wx += step) {
      const x = Math.round(wx * scale) + 0.5
      g.beginPath()
      g.moveTo(x, 0)
      g.lineTo(x, height)
      g.stroke()
      if (wx > 0) label(String(wx), x + 3, 2)
    }
    for (let wy = 0; wy * scale <= height; wy += step) {
      const y = Math.round(wy * scale) + 0.5
      g.beginPath()
      g.moveTo(0, y)
      g.lineTo(width, y)
      g.stroke()
      if (wy > 0) label(String(wy), 3, y + 2)
    }
  }

  for (const a of actors) {
    const cx = a.x * scale
    const cy = a.y * scale
    if (guides.boxes) {
      const [w, h] = [a.size[0] * scale, a.size[1] * scale]
      g.strokeStyle = '#22d3ee'
      g.lineWidth = 1.5
      g.strokeRect(cx - w / 2, cy - h / 2, w, h)
      g.fillStyle = '#22d3ee'
      g.fillRect(cx - 2, cy - 2, 4, 4)
    }
    if (guides.direction) {
      const [dx, dy] = directionVector(a.direction)
      const length = Math.max(14, (Math.max(a.size[0], a.size[1]) * scale) / 2 + 10)
      const [ex, ey] = [cx + dx * length, cy + dy * length]
      g.strokeStyle = '#f97316'
      g.fillStyle = '#f97316'
      g.lineWidth = 2
      g.beginPath()
      g.moveTo(cx, cy)
      g.lineTo(ex, ey)
      g.stroke()
      // arrow head
      const head = 6
      const [px, py] = [-dy, dx]
      g.beginPath()
      g.moveTo(ex, ey)
      g.lineTo(ex - dx * head + px * head * 0.6, ey - dy * head + py * head * 0.6)
      g.lineTo(ex - dx * head - px * head * 0.6, ey - dy * head - py * head * 0.6)
      g.closePath()
      g.fill()
    }
  }
}

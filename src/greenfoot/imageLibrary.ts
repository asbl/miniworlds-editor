/** Small built-in image library, drawn at runtime (no files shipped). */
const SIZE = 64

export interface LibraryImage {
  id: 'smiley' | 'stern' | 'herz' | 'fisch' | 'baum' | 'rakete'
  /** Message key suffix: `image.lib.<id>`. */
  draw: (g: CanvasRenderingContext2D) => void
}

function fill(g: CanvasRenderingContext2D, color: string, path: () => void) {
  g.fillStyle = color
  g.beginPath()
  path()
  g.fill()
}

export const LIBRARY: LibraryImage[] = [
  {
    id: 'smiley',
    draw: (g) => {
      fill(g, '#f7cf3a', () => g.arc(32, 32, 28, 0, 7))
      g.strokeStyle = '#9a6a00'
      g.lineWidth = 3
      g.stroke()
      fill(g, '#3a2a00', () => {
        g.arc(22, 26, 4, 0, 7)
        g.moveTo(46, 26)
        g.arc(42, 26, 4, 0, 7)
      })
      g.beginPath()
      g.arc(32, 36, 14, 0.15 * Math.PI, 0.85 * Math.PI)
      g.stroke()
    },
  },
  {
    id: 'stern',
    draw: (g) => {
      fill(g, '#f5b800', () => {
        for (let i = 0; i < 10; i++) {
          const r = i % 2 ? 12 : 29
          const a = -Math.PI / 2 + (i * Math.PI) / 5
          if (i) g.lineTo(32 + r * Math.cos(a), 33 + r * Math.sin(a))
          else g.moveTo(32 + r * Math.cos(a), 33 + r * Math.sin(a))
        }
        g.closePath()
      })
      g.strokeStyle = '#a06800'
      g.lineWidth = 2
      g.stroke()
    },
  },
  {
    id: 'herz',
    draw: (g) =>
      fill(g, '#e0364a', () => {
        g.moveTo(32, 56)
        g.bezierCurveTo(2, 36, 8, 8, 24, 10)
        g.bezierCurveTo(30, 11, 32, 18, 32, 20)
        g.bezierCurveTo(32, 18, 34, 11, 40, 10)
        g.bezierCurveTo(56, 8, 62, 36, 32, 56)
      }),
  },
  {
    id: 'fisch',
    draw: (g) => {
      fill(g, '#ff8a2a', () => g.ellipse(26, 32, 22, 15, 0, 0, 7))
      fill(g, '#ff8a2a', () => {
        g.moveTo(44, 32)
        g.lineTo(62, 18)
        g.lineTo(62, 46)
        g.closePath()
      })
      fill(g, '#fff', () => g.arc(16, 28, 4, 0, 7))
      fill(g, '#222', () => g.arc(15, 28, 2, 0, 7))
    },
  },
  {
    id: 'baum',
    draw: (g) => {
      fill(g, '#7a4a1e', () => g.rect(28, 38, 8, 22))
      fill(g, '#2f9a45', () => g.arc(32, 26, 20, 0, 7))
      fill(g, '#3cb455', () => g.arc(24, 22, 9, 0, 7))
    },
  },
  {
    id: 'rakete',
    draw: (g) => {
      fill(g, '#c9ced8', () => g.ellipse(32, 30, 11, 25, 0, 0, 7))
      fill(g, '#d23c3c', () => {
        g.moveTo(21, 20)
        g.lineTo(32, 3)
        g.lineTo(43, 20)
        g.closePath()
      })
      fill(g, '#d23c3c', () => {
        g.moveTo(21, 40)
        g.lineTo(9, 56)
        g.lineTo(23, 52)
        g.closePath()
        g.moveTo(43, 40)
        g.lineTo(55, 56)
        g.lineTo(41, 52)
        g.closePath()
      })
      fill(g, '#5aa0e6', () => g.arc(32, 28, 5, 0, 7))
    },
  },
]

export function renderLibraryImage(item: LibraryImage): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SIZE
  const g = canvas.getContext('2d') as CanvasRenderingContext2D
  g.lineJoin = 'round'
  item.draw(g)
  return canvas
}

export const libraryDataUrl = (item: LibraryImage) => renderLibraryImage(item).toDataURL('image/png')

export const libraryBytes = (item: LibraryImage): Promise<Uint8Array> =>
  new Promise((resolve, reject) =>
    renderLibraryImage(item).toBlob((blob) => (blob ? void blob.arrayBuffer().then((b) => resolve(new Uint8Array(b))) : reject(new Error('toBlob failed'))), 'image/png'),
  )

const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg' }
export function mimeOf(path: string): string {
  const ext = (/\.(\w+)$/.exec(path)?.[1] ?? 'png').toLowerCase()
  return MIME[ext] ?? `image/${ext}`
}

/** Natural size of an image, or null if it cannot be decoded. */
export function imageSize(bytes: Uint8Array, path: string): Promise<[number, number] | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeOf(path) }))
    const img = new Image()
    img.onload = () => (URL.revokeObjectURL(url), resolve([img.naturalWidth, img.naturalHeight]))
    img.onerror = () => (URL.revokeObjectURL(url), resolve(null))
    img.src = url
  })
}

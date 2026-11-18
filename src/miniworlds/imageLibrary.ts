/** Small built-in image library, drawn at runtime (no files shipped). */
const SIZE = 64

export type LibraryCategory = 'figures' | 'animals' | 'things' | 'backgrounds'
export const CATEGORIES: LibraryCategory[] = ['figures', 'animals', 'things', 'backgrounds']

/**
 * Every picture is drawn here, in code: original work of this project (MIT, like the rest), so pupils can use, change and
 * share them without asking anyone. Nothing in the library is copied from elsewhere; keep it that way.
 */
export interface LibraryImage {
  /** Message key suffix: `image.lib.<id>`; also the file name `images/<id>.png`. */
  id: string
  category: LibraryCategory
  /** Pixel size; default 64×64 (backgrounds 320×240). */
  size?: [number, number]
  draw: (g: CanvasRenderingContext2D) => void
}

function fill(g: CanvasRenderingContext2D, color: string, path: () => void) {
  g.fillStyle = color
  g.beginPath()
  path()
  g.fill()
}

const disc = (g: CanvasRenderingContext2D, color: string, x: number, y: number, r: number) => fill(g, color, () => g.arc(x, y, r, 0, 7))
const box = (g: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number) => fill(g, color, () => g.rect(x, y, w, h))
const poly = (g: CanvasRenderingContext2D, color: string, points: [number, number][]) =>
  fill(g, color, () => {
    points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)))
    g.closePath()
  })
const outline = (g: CanvasRenderingContext2D, color: string, width = 2) => {
  g.strokeStyle = color
  g.lineWidth = width
  g.stroke()
}
function gradient(g: CanvasRenderingContext2D, w: number, h: number, stops: [number, string][]) {
  const grad = g.createLinearGradient(0, 0, 0, h)
  for (const [at, color] of stops) grad.addColorStop(at, color)
  g.fillStyle = grad
  g.fillRect(0, 0, w, h)
}

export const LIBRARY: LibraryImage[] = [
  {
    id: 'smiley',
    category: 'figures',
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
    category: 'things',
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
    category: 'things',
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
    category: 'animals',
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
    category: 'things',
    draw: (g) => {
      fill(g, '#7a4a1e', () => g.rect(28, 38, 8, 22))
      fill(g, '#2f9a45', () => g.arc(32, 26, 20, 0, 7))
      fill(g, '#3cb455', () => g.arc(24, 22, 9, 0, 7))
    },
  },
  {
    id: 'rakete',
    category: 'things',
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

  // ---- figures ----
  {
    id: 'roboter',
    category: 'figures',
    draw: (g) => {
      box(g, '#8d99ae', 14, 18, 36, 30)
      box(g, '#8d99ae', 20, 50, 8, 10)
      box(g, '#8d99ae', 36, 50, 8, 10)
      box(g, '#cfd6e4', 18, 6, 28, 14)
      disc(g, '#ef476f', 26, 13, 3)
      disc(g, '#ef476f', 38, 13, 3)
      box(g, '#2b2d42', 22, 28, 20, 8)
      box(g, '#ffd166', 30, 0, 4, 7)
    },
  },
  {
    id: 'geist',
    category: 'figures',
    draw: (g) => {
      fill(g, '#f1f5f9', () => {
        g.moveTo(10, 58)
        g.lineTo(10, 28)
        g.arc(32, 28, 22, Math.PI, 0)
        g.lineTo(54, 58)
        g.lineTo(46, 50)
        g.lineTo(38, 58)
        g.lineTo(32, 50)
        g.lineTo(26, 58)
        g.lineTo(18, 50)
      })
      disc(g, '#1e293b', 24, 28, 4)
      disc(g, '#1e293b', 40, 28, 4)
      disc(g, '#1e293b', 32, 40, 3)
    },
  },
  {
    id: 'alien',
    category: 'figures',
    draw: (g) => {
      fill(g, '#7bd389', () => g.ellipse(32, 34, 22, 26, 0, 0, 7))
      fill(g, '#1e293b', () => {
        g.ellipse(23, 30, 6, 9, -0.4, 0, 7)
        g.moveTo(47, 30)
        g.ellipse(41, 30, 6, 9, 0.4, 0, 7)
      })
      box(g, '#1e293b', 26, 48, 12, 3)
      box(g, '#7bd389', 12, 4, 3, 10)
      box(g, '#7bd389', 49, 4, 3, 10)
      disc(g, '#ffd166', 13, 4, 4)
      disc(g, '#ffd166', 51, 4, 4)
    },
  },
  {
    id: 'zauberer',
    category: 'figures',
    draw: (g) => {
      poly(g, '#5b3cc4', [[32, 2], [48, 34], [16, 34]])
      box(g, '#4a2fa3', 8, 33, 48, 6)
      disc(g, '#f6c28b', 32, 46, 12)
      fill(g, '#e2e8f0', () => g.ellipse(32, 56, 11, 6, 0, 0, 7))
      disc(g, '#1e293b', 27, 44, 2)
      disc(g, '#1e293b', 37, 44, 2)
      disc(g, '#ffd166', 32, 20, 3)
    },
  },
  // ---- animals ----
  {
    id: 'krabbe',
    category: 'animals',
    draw: (g) => {
      g.strokeStyle = '#d6452f'
      g.lineWidth = 3
      for (const x of [14, 22, 42, 50]) {
        g.beginPath()
        g.moveTo(x, 40)
        g.lineTo(x < 32 ? x - 8 : x + 8, 54)
        g.stroke()
      }
      fill(g, '#e8573f', () => g.ellipse(32, 38, 20, 14, 0, 0, 7))
      disc(g, '#e8573f', 10, 18, 8)
      disc(g, '#e8573f', 54, 18, 8)
      g.strokeStyle = '#e8573f'
      g.lineWidth = 4
      g.beginPath()
      g.moveTo(16, 34)
      g.lineTo(10, 22)
      g.moveTo(48, 34)
      g.lineTo(54, 22)
      g.stroke()
      disc(g, '#fff', 25, 26, 4)
      disc(g, '#fff', 39, 26, 4)
      disc(g, '#222', 25, 26, 2)
      disc(g, '#222', 39, 26, 2)
    },
  },
  {
    id: 'wurm',
    category: 'animals',
    draw: (g) => {
      g.lineCap = 'round'
      g.strokeStyle = '#e59aa8'
      g.lineWidth = 9
      g.beginPath()
      g.moveTo(8, 44)
      g.bezierCurveTo(18, 14, 30, 60, 42, 30)
      g.bezierCurveTo(46, 20, 54, 24, 56, 34)
      g.stroke()
      disc(g, '#222', 53, 30, 2)
    },
  },
  {
    id: 'vogel',
    category: 'animals',
    draw: (g) => {
      fill(g, '#4aa3df', () => g.ellipse(30, 36, 20, 15, 0, 0, 7))
      disc(g, '#4aa3df', 46, 24, 10)
      poly(g, '#f6ae2d', [[54, 22], [64, 26], [54, 29]])
      poly(g, '#2f7fb8', [[22, 36], [8, 22], [34, 30]])
      poly(g, '#4aa3df', [[12, 40], [2, 50], [16, 46]])
      disc(g, '#fff', 48, 22, 3)
      disc(g, '#222', 49, 22, 1.5)
    },
  },
  {
    id: 'katze',
    category: 'animals',
    draw: (g) => {
      poly(g, '#f19a3e', [[12, 26], [14, 4], [28, 16]])
      poly(g, '#f19a3e', [[52, 26], [50, 4], [36, 16]])
      disc(g, '#f19a3e', 32, 36, 24)
      disc(g, '#fff', 24, 32, 5)
      disc(g, '#fff', 40, 32, 5)
      disc(g, '#222', 24, 32, 2.5)
      disc(g, '#222', 40, 32, 2.5)
      poly(g, '#e86f7d', [[29, 40], [35, 40], [32, 44]])
      g.strokeStyle = '#7a4a1e'
      g.lineWidth = 1.5
      g.beginPath()
      g.moveTo(8, 40)
      g.lineTo(24, 44)
      g.moveTo(8, 48)
      g.lineTo(24, 47)
      g.moveTo(56, 40)
      g.lineTo(40, 44)
      g.moveTo(56, 48)
      g.lineTo(40, 47)
      g.stroke()
    },
  },
  {
    id: 'hai',
    category: 'animals',
    draw: (g) => {
      fill(g, '#7f93a8', () => {
        g.moveTo(2, 40)
        g.bezierCurveTo(14, 18, 44, 18, 62, 40)
        g.bezierCurveTo(46, 52, 16, 52, 2, 40)
      })
      poly(g, '#6a7e93', [[26, 24], [34, 6], [40, 26]])
      poly(g, '#6a7e93', [[6, 38], [0, 30], [0, 48]])
      fill(g, '#eef2f6', () => g.ellipse(34, 44, 22, 6, 0, 0, Math.PI))
      disc(g, '#fff', 48, 34, 4)
      disc(g, '#111', 49, 34, 2)
    },
  },
  // ---- things ----
  {
    id: 'muenze',
    category: 'things',
    draw: (g) => {
      disc(g, '#e0a526', 32, 32, 26)
      disc(g, '#f6cf4a', 32, 32, 21)
      g.fillStyle = '#b8791a'
      g.font = 'bold 28px sans-serif'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText('1', 32, 34)
    },
  },
  {
    id: 'apfel',
    category: 'things',
    draw: (g) => {
      fill(g, '#e03b3b', () => {
        g.moveTo(32, 18)
        g.bezierCurveTo(48, 6, 62, 22, 56, 40)
        g.bezierCurveTo(52, 56, 40, 60, 32, 56)
        g.bezierCurveTo(24, 60, 12, 56, 8, 40)
        g.bezierCurveTo(2, 22, 16, 6, 32, 18)
      })
      box(g, '#6b4423', 30, 6, 4, 12)
      fill(g, '#3cb455', () => g.ellipse(41, 10, 8, 4, -0.5, 0, 7))
      fill(g, '#f5a0a0', () => g.ellipse(20, 26, 4, 7, 0.5, 0, 7))
    },
  },
  {
    id: 'schluessel',
    category: 'things',
    draw: (g) => {
      g.strokeStyle = '#e0a526'
      g.lineWidth = 7
      g.beginPath()
      g.arc(18, 22, 11, 0, 7)
      g.stroke()
      box(g, '#e0a526', 24, 29, 8, 30)
      box(g, '#e0a526', 32, 44, 10, 5)
      box(g, '#e0a526', 32, 53, 8, 5)
    },
  },
  {
    id: 'kiste',
    category: 'things',
    draw: (g) => {
      box(g, '#b07840', 6, 14, 52, 42)
      box(g, '#8a5a2b', 6, 14, 52, 6)
      box(g, '#8a5a2b', 6, 50, 52, 6)
      box(g, '#8a5a2b', 6, 14, 6, 42)
      box(g, '#8a5a2b', 52, 14, 6, 42)
      box(g, '#e0a526', 28, 28, 8, 10)
    },
  },
  {
    id: 'haus',
    category: 'things',
    draw: (g) => {
      box(g, '#e8d3a6', 10, 28, 44, 30)
      poly(g, '#c0504d', [[4, 30], [32, 6], [60, 30]])
      box(g, '#7a4a1e', 26, 40, 12, 18)
      box(g, '#8ecae6', 14, 34, 9, 9)
      box(g, '#8ecae6', 41, 34, 9, 9)
    },
  },
  {
    id: 'bombe',
    category: 'things',
    draw: (g) => {
      disc(g, '#2b2d42', 30, 38, 22)
      disc(g, '#4a4e69', 22, 30, 6)
      box(g, '#8d99ae', 26, 12, 10, 8)
      g.strokeStyle = '#b07840'
      g.lineWidth = 3
      g.beginPath()
      g.moveTo(34, 12)
      g.quadraticCurveTo(42, 2, 50, 8)
      g.stroke()
      disc(g, '#ffd166', 52, 8, 5)
      disc(g, '#ef476f', 52, 8, 2.5)
    },
  },
  // ---- backgrounds ----
  {
    id: 'wiese',
    category: 'backgrounds',
    draw: (g) => {
      gradient(g, 320, 240, [[0, '#9ad8f5'], [0.45, '#d8f1fb'], [0.451, '#79c36b'], [1, '#4f9d45']])
      disc(g, '#ffe066', 270, 40, 22)
      for (const [x, y] of [[40, 150], [120, 190], [220, 160], [290, 210], [70, 220]]) {
        disc(g, '#fff', x as number, y as number, 4)
        disc(g, '#ffd166', x as number, y as number, 1.8)
      }
    },
  },
  {
    id: 'wasser',
    category: 'backgrounds',
    draw: (g) => {
      gradient(g, 320, 240, [[0, '#5ec2e8'], [1, '#0d4f8b']])
      g.strokeStyle = 'rgba(255,255,255,0.35)'
      g.lineWidth = 2
      for (let y = 30; y < 240; y += 42) {
        g.beginPath()
        for (let x = 0; x <= 320; x += 8) g.lineTo(x, y + Math.sin((x + y) / 14) * 4)
        g.stroke()
      }
    },
  },
  {
    id: 'himmel',
    category: 'backgrounds',
    draw: (g) => {
      gradient(g, 320, 240, [[0, '#2f80d0'], [1, '#bfe6fb']])
      for (const [x, y, r] of [[70, 60, 22], [230, 110, 28], [150, 180, 18]]) {
        disc(g, '#fff', x as number, y as number, r as number)
        disc(g, '#fff', (x as number) + (r as number), (y as number) + 6, (r as number) * 0.8)
        disc(g, '#fff', (x as number) - (r as number), (y as number) + 8, (r as number) * 0.7)
      }
    },
  },
  {
    id: 'weltraum',
    category: 'backgrounds',
    draw: (g) => {
      gradient(g, 320, 240, [[0, '#050816'], [1, '#1b1b4b']])
      let seed = 7
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
      for (let i = 0; i < 70; i++) disc(g, `rgba(255,255,255,${0.4 + rnd() * 0.6})`, rnd() * 320, rnd() * 240, 0.6 + rnd() * 1.4)
      disc(g, '#c8553d', 250, 60, 24)
      disc(g, 'rgba(0,0,0,0.25)', 258, 66, 18)
    },
  },
  {
    id: 'wueste',
    category: 'backgrounds',
    draw: (g) => {
      gradient(g, 320, 240, [[0, '#f9c784'], [0.5, '#fde8c0'], [0.501, '#e9b872'], [1, '#c9954e']])
      fill(g, '#d9a35e', () => {
        g.moveTo(0, 130)
        g.bezierCurveTo(80, 90, 160, 150, 320, 110)
        g.lineTo(320, 240)
        g.lineTo(0, 240)
      })
      disc(g, '#fff3b0', 70, 50, 20)
    },
  },
  {
    id: 'raster',
    category: 'backgrounds',
    draw: (g) => {
      box(g, '#f4f6f8', 0, 0, 320, 240)
      g.strokeStyle = '#c7ced6'
      g.lineWidth = 1
      for (let x = 0; x <= 320; x += 40) {
        g.beginPath()
        g.moveTo(x + 0.5, 0)
        g.lineTo(x + 0.5, 240)
        g.stroke()
      }
      for (let y = 0; y <= 240; y += 40) {
        g.beginPath()
        g.moveTo(0, y + 0.5)
        g.lineTo(320, y + 0.5)
        g.stroke()
      }
    },
  },
]

export const sizeOf = (item: LibraryImage): [number, number] => item.size ?? (item.category === 'backgrounds' ? [320, 240] : [SIZE, SIZE])

export function renderLibraryImage(item: LibraryImage): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  ;[canvas.width, canvas.height] = sizeOf(item)
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

/** The grey square with a question mark that stands in for a picture that was not cleared for sharing. */
export function placeholderBytes(): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SIZE
  const g = canvas.getContext('2d') as CanvasRenderingContext2D
  g.fillStyle = '#c9ced6'
  g.fillRect(0, 0, SIZE, SIZE)
  g.strokeStyle = '#8b94a1'
  g.lineWidth = 3
  g.strokeRect(1.5, 1.5, SIZE - 3, SIZE - 3)
  g.fillStyle = '#5b6472'
  g.font = 'bold 40px sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('?', SIZE / 2, SIZE / 2 + 2)
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? void blob.arrayBuffer().then((b) => resolve(new Uint8Array(b))) : reject(new Error('toBlob failed'))), 'image/png'),
  )
}

/** The world in a browser window or tab of its own: the page's canvas element is moved there (it keeps drawing, the worker owns its pixels). */
export type WorldWindowKind = 'window' | 'tab'

export interface WorldWindow {
  kind: WorldWindowKind
  win: Window
  /** Where the canvas goes. */
  stage: HTMLElement
  /** Keep the canvas's proportions while the window is resized. */
  setRatio: (width: number, height: number) => void
  close: () => void
}

const STYLE = `
html, body { margin: 0; height: 100%; background: #111; overflow: hidden; }
#stage { height: 100%; display: grid; place-items: center; --ar: 1.3333; }
canvas { display: block; width: min(100vw, calc(100vh * var(--ar))); height: auto; background: #000; outline: none; }
`

/** Must run inside a click handler (pop-up blockers). Returns null when the browser refuses. */
export function openWorldWindow(kind: WorldWindowKind, size: { width: number; height: number }, title: string): WorldWindow | null {
  let win: Window | null = null
  try {
    const features = kind === 'window' ? `popup=yes,width=${Math.round(Math.max(360, size.width + 32))},height=${Math.round(Math.max(300, size.height + 56))}` : undefined
    win = window.open('about:blank', '_blank', features)
  } catch {
    win = null
  }
  if (!win || win.closed || !win.document) return null
  const doc = win.document
  doc.title = title
  const style = doc.createElement('style')
  style.textContent = STYLE
  doc.head.append(style)
  const stage = doc.createElement('div')
  stage.id = 'stage'
  doc.body.append(stage)
  const handle: WorldWindow = {
    kind,
    win,
    stage,
    setRatio: (w, h) => {
      if (w > 0 && h > 0) stage.style.setProperty('--ar', String(w / h))
    },
    close: () => {
      try {
        win?.close()
      } catch {
        /* already gone */
      }
    },
  }
  handle.setRatio(size.width, size.height)
  return handle
}

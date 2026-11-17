import { boot, runScene } from './runtime.js'

// SDL registers input callbacks on `document` (pointer lock, fullscreen, ...). Minimal stand-in so registration succeeds;
// real input has to be forwarded from the main thread (see 'event' messages below).
if (typeof self.document === 'undefined') {
  const doc = new EventTarget()
  Object.assign(doc, { pointerLockElement: null, fullscreenElement: null, body: {}, querySelector: () => null,
    getElementById: () => self.__canvas ?? null, hasFocus: () => true })
  self.document = doc
}
// SDL's emscripten backend reads window.screen; workers have none. Minimal polyfill.
if (typeof self.screen === 'undefined') {
  self.screen = { width: 1920, height: 1080, availWidth: 1920, availHeight: 1080 }
}

// Main thread owns the OffscreenCanvas transfer; everything else happens here.
self.onmessage = async (event) => {
  const { type } = event.data
  if (type === 'run') {
    const { canvas, scene, seconds } = event.data
    // SDL's emscripten backend treats the canvas like an HTMLCanvasElement: give the OffscreenCanvas the bits it touches.
    self.__canvas = canvas
    canvas.style = {}
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: canvas.width, height: canvas.height })
    canvas.focus = () => {}
    try {
      const pyodide = await boot(canvas, (t) => self.postMessage({ type: 'log', text: t }))
      self.pyodide = pyodide
      const result = await runScene(pyodide, scene, seconds)
      self.postMessage({ type: 'result', result })
    } catch (error) {
      self.postMessage({ type: 'error', text: String(error?.stack ?? error) })
    }
  } else if (type === 'event') {
    // forwarded input (worker has no DOM): inject into pygame's queue
    const { kind, key, x, y } = event.data
    self.pyodide?.runPython(
      kind === 'keydown'
        ? `import pygame; pygame.event.post(pygame.event.Event(pygame.KEYDOWN, key=${key}, mod=0, unicode="", scancode=0))`
        : kind === 'keyup'
          ? `import pygame; pygame.event.post(pygame.event.Event(pygame.KEYUP, key=${key}, mod=0, unicode="", scancode=0))`
          : kind === 'mouseup'
            ? `import pygame; pygame.event.post(pygame.event.Event(pygame.MOUSEBUTTONUP, pos=(${x}, ${y}), button=1))`
            : `import pygame; pygame.event.post(pygame.event.Event(pygame.MOUSEBUTTONDOWN, pos=(${x}, ${y}), button=1))`,
    )
  }
}

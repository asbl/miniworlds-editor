import { PYODIDE_BASE } from './config'
import { Runner, type WorkerLike } from './runner'

/** The editor's runner: real module Worker, real canvas. */
export function createBrowserRunner(pyodideBase: string = PYODIDE_BASE): Runner {
  return new Runner({
    pyodideBase,
    createWorker: () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike,
    createCanvas: () => {
      const canvas = document.createElement('canvas')
      canvas.id = 'canvas' // SDL (Emscripten) looks the canvas up by this id
      canvas.className = 'world-canvas'
      canvas.tabIndex = 0 // focusable: keyboard input is forwarded only while it has focus
      canvas.width = 400
      canvas.height = 300
      return canvas
    },
  })
}

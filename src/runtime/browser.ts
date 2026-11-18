import { PYODIDE_BASE } from './config'
import { WebAudioEngine } from './audio'
import { Runner, type WorkerLike } from './runner'

const MUTE_KEY = 'miniworlds-editor.muted'

function createEngine(): WebAudioEngine {
  const engine = new WebAudioEngine()
  try {
    engine.setMuted(localStorage.getItem(MUTE_KEY) === '1')
  } catch {
    /* sound on */
  }
  return engine
}

export function rememberMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
  } catch {
    /* not remembered */
  }
}

/** The editor's runner: real module Worker, real canvas. */
export function createBrowserRunner(pyodideBase: string = PYODIDE_BASE): Runner {
  return new Runner({
    pyodideBase,
    audio: typeof AudioContext === 'undefined' ? undefined : createEngine(),
    inputBase: typeof document === 'undefined' ? undefined : new URL('__mw_stdin__/', document.baseURI).href,
    replyToServiceWorker: (base, id, text) => void fetch(`${base}${id}`, { method: 'POST', body: JSON.stringify({ text }) }).catch(() => {}),
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

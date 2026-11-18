import type { EngineHint, FromLanguage, Hover, JediItem, RuffDiagnostic, Signature, ToLanguage } from './protocol'

export interface LanguageWorkerLike {
  postMessage(message: ToLanguage): void
  terminate(): void
  onmessage: ((event: { data: FromLanguage }) => void) | null
  onerror: ((event: { message?: string }) => void) | null
}

/** `dormant`: low-memory mode, the worker is not running (yet, or any more) and starts when it is needed. */
export type LanguagePhase = 'idle' | 'dormant' | 'booting' | 'ready' | 'error'

export interface LanguageState {
  phase: LanguagePhase
  /** The engine version has miniworlds' beginner hints. */
  hints: boolean
  /** ruff (lint and format) loaded. */
  ruff: boolean
  /** The Python part (completion, hover, hints) loaded; false when only ruff came up, e.g. offline. */
  python: boolean
}

export interface LanguageEnv {
  createWorker(): LanguageWorkerLike
  pyodideBase: string
}

const REQUEST_TIMEOUT_MS = 8000

function sameFiles(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k])
}

/**
 * Editor intelligence in its own worker: jedi (completion, hover), miniworlds hints and ruff (lint, format).
 * Separate from the world's worker, so a crashed or busy program never takes the editor help down.
 * Every request degrades to "no answer" instead of failing: help is optional, typing is not.
 */
export class LanguageService {
  state: LanguageState = { phase: 'idle', hints: false, ruff: false, python: false }
  private worker: LanguageWorkerLike | null = null
  private bootedFor: string | null | undefined = undefined
  private ready: Promise<boolean> | null = null
  private resolveReady: ((ok: boolean) => void) | null = null
  private pending = new Map<number, { resolve: (value: unknown) => void; timer: ReturnType<typeof setTimeout> }>()
  private nextId = 1
  /** A concrete version requested while the "newest" boot was still running. */
  private wanted: string | null = null
  private lastVersion: string | null = null
  /** Low-memory mode: the second Python (about 130 MB) only runs while the user works on the code. */
  private lazy = false
  private prepared: string | null | undefined = undefined
  private lastUsed = Date.now()
  private installed: string | null = null
  private lastApi: string | null = null
  private lastFiles: Record<string, string> | null = null
  private listeners = new Set<() => void>()

  constructor(private env: LanguageEnv) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  private set(patch: Partial<LanguageState>): void {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((l) => l())
  }

  setLazy(lazy: boolean): void {
    this.lazy = lazy
  }

  /** In lazy mode the worker is not running (yet): nothing to answer, and no reason to start one just to look. */
  get dormant(): boolean {
    return this.lazy && this.worker === null && this.state.phase === 'dormant'
  }

  /** Engine version to use. Eager mode boots now; lazy mode only remembers it until `wake()`. */
  prepare(miniworlds: string | null): void {
    if (!this.lazy) return void this.ensure(miniworlds)
    this.prepared = miniworlds
    if (this.worker) void this.ensure(miniworlds) // already running: follow the version
    else if (this.state.phase === 'idle') this.set({ phase: 'dormant' })
  }

  /** Start the worker if it sleeps (editing, completion and hover call this). */
  wake(): void {
    this.lastUsed = Date.now()
    if (this.dormant && this.prepared !== undefined) void this.ensure(this.prepared)
  }

  /** Free the memory again after the user stopped editing. */
  sleepIfIdle(idleMs: number): boolean {
    if (!this.lazy || this.state.phase !== 'ready' || Date.now() - this.lastUsed < idleMs) return false
    this.discard()
    this.set({ phase: 'dormant', hints: false, ruff: false, python: false })
    return true
  }

  /**
   * Boot for this engine version (null = newest). A different version restarts the worker (API and hints are version-specific).
   * A worker that already boots "newest" is kept when a concrete version is asked for while it has not finished yet:
   * restarting would repeat the whole download on a slow network; the version is corrected after it is ready.
   */
  ensure(miniworlds: string | null): Promise<boolean> {
    if (this.worker && this.bootedFor === miniworlds && this.ready) return this.ready
    if (this.worker && this.ready && this.state.phase === 'booting' && this.bootedFor === null && miniworlds !== null) {
      this.wanted = miniworlds
      return this.ready
    }
    this.wanted = null
    this.lastVersion = miniworlds
    this.lastUsed = Date.now()
    this.discard()
    const worker = this.env.createWorker()
    this.worker = worker
    this.bootedFor = miniworlds
    this.ready = new Promise<boolean>((resolve) => (this.resolveReady = resolve))
    this.set({ phase: 'booting', hints: false, ruff: false, python: false })
    worker.onmessage = ({ data }) => this.onMessage(worker, data)
    worker.onerror = () => this.fail(worker)
    worker.postMessage({ type: 'boot', pyodideBase: this.env.pyodideBase, miniworlds })
    return this.ready
  }

  /** Boot again for the last requested version (after the network came back). */
  retry(): Promise<boolean> {
    const version = this.lastVersion
    this.discard()
    return this.ensure(version)
  }

  private fail(worker: LanguageWorkerLike): void {
    if (worker !== this.worker) return
    this.discard()
    this.set({ phase: 'error' })
  }

  private discard(): void {
    this.worker?.terminate()
    if (this.worker) {
      this.worker.onmessage = null
      this.worker.onerror = null
    }
    this.worker = null
    this.bootedFor = undefined
    this.resolveReady?.(false)
    this.resolveReady = null
    this.ready = null
    for (const { resolve, timer } of this.pending.values()) (clearTimeout(timer), resolve(null))
    this.pending.clear()
  }

  private onMessage(worker: LanguageWorkerLike, message: FromLanguage): void {
    if (worker !== this.worker) return
    if (message.type === 'ready') {
      // a restart must not lose what the new worker needs to know
      if (this.lastApi) worker.postMessage({ type: 'api', index: this.lastApi })
      if (this.lastFiles) worker.postMessage({ type: 'sync', files: this.lastFiles })
      this.set({ phase: 'ready', hints: message.hints, ruff: message.ruff, python: message.python })
      this.resolveReady?.(true)
      this.installed = message.version
      // the world turned out to run another version than the "newest" this worker was booted for
      const wanted = this.wanted
      this.wanted = null
      if (wanted !== null && wanted !== this.installed) void this.ensure(wanted)
    } else if (message.type === 'boot-error') {
      console.warn('Language worker failed to boot', message.text)
      this.fail(worker)
    } else {
      const entry = this.pending.get(message.id)
      if (entry) (clearTimeout(entry.timer), entry.resolve(message.ok ? message.value : null))
      this.pending.delete(message.id)
    }
  }

  /** miniworlds' API index (JSON text) from the world worker; enables hints and `self.world.` completion. */
  setApi(index: string): void {
    this.lastApi = index
    if (this.state.phase === 'ready') this.worker?.postMessage({ type: 'api', index })
  }

  /** All Python sources of the project (so jedi can follow imports between files). */
  sync(files: Record<string, string>): void {
    const before = this.lastFiles
    this.lastFiles = files
    if (before && sameFiles(before, files)) return
    if (this.state.phase === 'ready') this.worker?.postMessage({ type: 'sync', files })
  }

  private async request<T>(name: Extract<ToLanguage, { type: 'req' }>['name'], ...args: unknown[]): Promise<T | null> {
    this.wake()
    if (!(await (this.ready ?? Promise.resolve(false)))) return null
    const worker = this.worker
    if (!worker || this.state.phase !== 'ready') return null
    const id = this.nextId++
    return new Promise<T | null>((resolve) => {
      const timer = setTimeout(() => (this.pending.delete(id), resolve(null)), REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve: (value) => resolve(value as T | null), timer })
      worker.postMessage({ type: 'req', id, name, args })
    })
  }

  async complete(path: string, source: string, line: number, col: number): Promise<JediItem[]> {
    return (await this.request<JediItem[]>('complete', path, source, line, col)) ?? []
  }
  hover(path: string, source: string, line: number, col: number): Promise<Hover | null> {
    return this.request<Hover>('hover', path, source, line, col)
  }
  signature(path: string, source: string, line: number, col: number): Promise<Signature | null> {
    return this.request<Signature>('signature', path, source, line, col)
  }
  async hints(files: Record<string, string>): Promise<EngineHint[]> {
    return (await this.request<EngineHint[]>('hints', JSON.stringify(files))) ?? []
  }
  async lint(source: string): Promise<RuffDiagnostic[]> {
    return (await this.request<RuffDiagnostic[]>('lint', source)) ?? []
  }
  /** Formatted source, or null when ruff is not available. */
  format(source: string): Promise<string | null> {
    return this.request<string>('format', source)
  }

  dispose(): void {
    this.discard()
    this.listeners.clear()
  }
}

import { getLang, t } from '../i18n'
import { explainError } from './explain'
import type { AudioMessage, AudioSink } from './audio'
import { STOP_TIMEOUT_MS } from './config'
import type { BootStep, FileChanges, FromWorker, InputEvent, RpcReply, ToWorker } from './protocol'

export type Phase = 'idle' | 'booting' | 'ready' | 'running' | 'stopping'

export interface ConsoleLine {
  id: number
  kind: 'stdout' | 'stderr' | 'system' | 'input' | 'hint'
  text: string
}

/** What the runtime needs from a worker: a real `Worker` in the browser, a fake in tests. */
export interface WorkerLike {
  postMessage(message: ToWorker, transfer?: Transferable[]): void
  terminate(): void
  onmessage: ((event: { data: FromWorker }) => void) | null
  onerror: ((event: { message?: string }) => void) | null
}

export interface CanvasLike {
  transferControlToOffscreen(): OffscreenCanvas
}

export interface RunnerEnv<C extends CanvasLike = HTMLCanvasElement> {
  createWorker(): WorkerLike
  /** A fresh canvas: transferControlToOffscreen() works only once per element. */
  createCanvas(): C
  pyodideBase: string
  /** Address the Service Worker answers blocking reads on (see `input-request`); omitted: none. */
  inputBase?: string
  /** Plays the program's sound; omitted: sound is silenced. */
  audio?: AudioSink
  /** Hand a line to the Service Worker that holds the program's read open. */
  replyToServiceWorker?(base: string, id: string, text: string | null): void
}

export interface RuntimeConfig {
  /** Exact miniworlds version, or null for the newest. */
  miniworlds: string | null
  packages: string[]
}

export interface RunnerState {
  phase: Phase
  bootStep: BootStep | null
  /** Installed miniworlds version of the booted worker. */
  version: string | null
  lines: readonly ConsoleLine[]
  /** Increments whenever `canvas` is replaced. */
  canvasGeneration: number
  /** How the current/last program was started. */
  mode: 'program' | 'scenario' | null
  /** Scenario mode only: the world exists (paused) and answers commands. */
  scenarioReady: boolean
  /** The program waits in `input()`. */
  input: { id: string; prompt: string; via: 'worker' | 'service-worker' } | null
  /** The program has played sound: the page offers a mute button. */
  audioUsed: boolean
}

export interface RunResult extends FileChanges {
  /** Traceback if the program crashed, otherwise null. */
  error: string | null
  /** True when the user (or a restart) ended it. */
  stopped: boolean
}

const MAX_LINES = 2000
const configKey = (c: RuntimeConfig) => JSON.stringify([c.miniworlds, [...c.packages].sort()])
const NO_CHANGES: FileChanges = { changed: {}, deleted: [] }

interface Waiter<T> {
  resolve: (value: T) => void
  reject: (error: Error) => void
}

/**
 * Owns the Pyodide worker: boots it for a runtime configuration, runs and stops programs, collects console output.
 * Single program at a time. UI-framework free; components subscribe to `state`.
 */
export class Runner<C extends CanvasLike = HTMLCanvasElement> {
  state: RunnerState = { phase: 'idle', bootStep: null, version: null, lines: [], canvasGeneration: 0, mode: null, scenarioReady: false, input: null, audioUsed: false }
  canvas: C

  private worker: WorkerLike | null = null
  private bootedKey: string | null = null
  private boot: { key: string; promise: Promise<void>; waiter: Waiter<void> } | null = null
  private runWaiter: Waiter<RunResult> | null = null
  private stopWaiter: Waiter<FileChanges> | null = null
  private rpcWaiters = new Map<number, (reply: RpcReply) => void>()
  private nextRpc = 1
  private installWaiters = new Map<string, Waiter<{ ok: boolean; error?: string }>>()
  private stopTimer: ReturnType<typeof setTimeout> | null = null
  private listeners = new Set<() => void>()
  private nextLine = 1

  constructor(private env: RunnerEnv<C>) {
    this.canvas = env.createCanvas()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  private set(patch: Partial<RunnerState>): void {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((l) => l())
  }

  private log(kind: ConsoleLine['kind'], text: string): void {
    const lines = [...this.state.lines, { id: this.nextLine++, kind, text }]
    this.set({ lines: lines.length > MAX_LINES ? lines.slice(-MAX_LINES) : lines })
  }

  /** A line from the editor itself (not from the program), e.g. "start setup restored". */
  note(text: string, kind: ConsoleLine['kind'] = 'system'): void {
    this.log(kind, text)
  }

  clearConsole(): void {
    this.set({ lines: [] })
  }

  /** Boots (or reuses) a worker for this configuration. Switching configuration restarts the worker. */
  ensureBooted(config: RuntimeConfig): Promise<void> {
    const key = configKey(config)
    if (this.bootedKey === key && this.worker) return Promise.resolve()
    if (this.boot?.key === key) return this.boot.promise
    this.discardWorker(t('run.restartReason'))
    return this.startBoot(config, key)
  }

  private startBoot(config: RuntimeConfig, key: string): Promise<void> {
    // A transferred canvas cannot be reused: give the page a fresh one for every worker.
    this.canvas = this.env.createCanvas()
    const offscreen = this.canvas.transferControlToOffscreen()
    const worker = this.env.createWorker()
    this.worker = worker
    worker.onmessage = ({ data }) => this.onMessage(worker, data)
    worker.onerror = (event) => this.onCrash(worker, event.message ?? 'worker error')
    let waiter!: Waiter<void>
    const promise = new Promise<void>((resolve, reject) => (waiter = { resolve, reject }))
    promise.catch(() => {}) // callers handle it; avoid an unhandled rejection if nobody awaits
    this.boot = { key, promise, waiter }
    this.set({ phase: 'booting', bootStep: null, version: null, canvasGeneration: this.state.canvasGeneration + 1 })
    worker.postMessage(
      { type: 'boot', canvas: offscreen, pyodideBase: this.env.pyodideBase, miniworlds: config.miniworlds, packages: config.packages, inputBase: this.env.inputBase ?? null, audio: this.env.audio !== undefined },
      [offscreen],
    )
    return promise
  }

  /** Terminates the worker and fails everything that waits for it. */
  private discardWorker(reason: string): void {
    const worker = this.worker
    if (!worker) return
    worker.onmessage = null
    worker.onerror = null
    worker.terminate()
    this.worker = null
    this.bootedKey = null
    if (this.stopTimer) clearTimeout(this.stopTimer)
    this.stopTimer = null
    const error = new Error(reason)
    this.boot?.waiter.reject(error)
    this.boot = null
    this.runWaiter?.resolve({ ...NO_CHANGES, error: null, stopped: true })
    this.runWaiter = null
    this.stopWaiter?.resolve(NO_CHANGES)
    this.stopWaiter = null
    for (const waiter of this.installWaiters.values()) waiter.resolve({ ok: false, error: reason })
    this.installWaiters.clear()
    for (const resolve of this.rpcWaiters.values()) resolve({ ok: false, error: reason })
    this.rpcWaiters.clear()
    this.env.audio?.reset?.() // a new worker sends its sounds again; the old decoded ones would stay in memory
    this.set({ phase: 'idle', bootStep: null, version: null, scenarioReady: false, input: null })
  }

  private onCrash(worker: WorkerLike, text: string): void {
    if (worker !== this.worker) return
    this.log('stderr', t('run.workerCrashed', { reason: text }))
    this.discardWorker(text)
  }

  private onMessage(worker: WorkerLike, message: FromWorker): void {
    if (worker !== this.worker) return
    switch (message.type) {
      case 'progress':
        this.set({ bootStep: message.step })
        break
      case 'ready':
        this.bootedKey = this.boot?.key ?? null
        this.boot?.waiter.resolve()
        this.boot = null
        this.set({ phase: 'ready', bootStep: null, version: message.version })
        this.log('system', t('run.engineReady', { version: message.version }))
        break
      case 'boot-error': {
        this.log('stderr', message.text)
        if (message.hint === 'blocked') this.log('system', t('run.blocked'))
        const waiter = this.boot?.waiter
        this.discardWorker(message.text)
        waiter?.reject(new Error(message.text))
        break
      }
      case 'out':
        this.log(message.stream, message.text)
        break
      case 'audio': {
        const { type: _type, ...audio } = message
        this.env.audio?.handle(audio as AudioMessage)
        // the mute button is for programs that make sound; the engine also stops music while a world starts
        if (!this.state.audioUsed && (message.op === 'play' || message.op === 'music-play')) this.set({ audioUsed: true })
        break
      }
      case 'input-request':
        this.set({ input: { id: message.id, prompt: message.prompt, via: message.via } })
        break
      case 'notice':
        this.log('system', t('run.silentAudio'))
        break
      case 'exit': {
        const { error, changed, deleted } = message
        if (error) {
          this.log('stderr', error)
          const hint = explainError(error, getLang())
          if (hint) this.log('hint', `${t('run.hint')} ${hint}`)
        }
        this.log('system', t(error ? 'run.crashed' : 'run.finished'))
        this.env.audio?.stopAll()
        this.set({ phase: 'ready', scenarioReady: false, input: null })
        this.runWaiter?.resolve({ error, changed, deleted, stopped: false })
        this.runWaiter = null
        break
      }
      case 'stopped':
        if (this.stopTimer) clearTimeout(this.stopTimer)
        this.stopTimer = null
        this.env.audio?.stopAll()
        this.set({ phase: 'ready', scenarioReady: false, input: null })
        this.log('system', t('run.stopped'))
        this.runWaiter?.resolve({ changed: message.changed, deleted: message.deleted, error: null, stopped: true })
        this.runWaiter = null
        this.stopWaiter?.resolve({ changed: message.changed, deleted: message.deleted })
        this.stopWaiter = null
        break
      case 'scenario-ready':
        this.set({ scenarioReady: true })
        break
      case 'rpc-result': {
        const resolve = this.rpcWaiters.get(message.id)
        this.rpcWaiters.delete(message.id)
        resolve?.(message.reply)
        break
      }
      case 'installed': {
        const waiter = this.installWaiters.get(message.requirement)
        this.installWaiters.delete(message.requirement)
        waiter?.resolve({ ok: message.ok, error: message.error })
        break
      }
    }
  }

  /** Runs `entry` with the given project files. Resolves when the program ends (or is stopped). */
  async run(files: Record<string, Uint8Array>, entry: string, config: RuntimeConfig, options: { scenario?: boolean } = {}): Promise<RunResult> {
    if (this.state.phase === 'running' || this.state.phase === 'stopping') await this.stop()
    await this.ensureBooted(config)
    const worker = this.worker
    if (!worker) return { ...NO_CHANGES, error: null, stopped: true }
    const buffers: Record<string, ArrayBuffer> = {}
    const transfer: ArrayBuffer[] = []
    for (const [path, bytes] of Object.entries(files)) {
      const copy = bytes.slice().buffer as ArrayBuffer // keep the caller's data usable
      buffers[path] = copy
      transfer.push(copy)
    }
    const result = new Promise<RunResult>((resolve, reject) => (this.runWaiter = { resolve, reject }))
    this.set({ phase: 'running', mode: options.scenario ? 'scenario' : 'program', scenarioReady: false })
    this.log('system', t('run.started'))
    worker.postMessage({ type: 'run', files: buffers, entry, scenario: options.scenario ?? false }, transfer)
    return result
  }

  /** Asks the program to stop; if the worker does not answer in time (endless loop), it is terminated. */
  stop(): Promise<FileChanges> {
    if (this.stopWaiter) return new Promise((resolve, reject) => (this.stopWaiter = chain(this.stopWaiter as Waiter<FileChanges>, { resolve, reject })))
    if (this.state.phase === 'booting') {
      this.discardWorker(t('run.cancelled'))
      return Promise.resolve(NO_CHANGES)
    }
    if (!this.worker || this.state.phase !== 'running') return Promise.resolve(NO_CHANGES)
    const worker = this.worker
    this.answerInput(null) // a program waiting in input() has to let go first
    this.set({ phase: 'stopping' })
    const promise = new Promise<FileChanges>((resolve, reject) => (this.stopWaiter = { resolve, reject }))
    worker.postMessage({ type: 'stop' })
    this.stopTimer = setTimeout(() => {
      this.stopTimer = null
      this.log('stderr', t('run.hardStop'))
      this.discardWorker(t('run.hardStop'))
    }, STOP_TIMEOUT_MS)
    return promise
  }

  /** Throws away the worker; the next run boots a fresh one (also the way out of a crashed state). */
  restart(): void {
    this.discardWorker(t('run.restartReason'))
  }

  /** Installs into the running worker. On success the worker counts as booted for the configuration plus this package. */
  async install(requirement: string, config: RuntimeConfig): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.ensureBooted(config)
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    const worker = this.worker
    if (!worker) return { ok: false, error: t('run.cancelled') }
    const done = new Promise<{ ok: boolean; error?: string }>((resolve, reject) => this.installWaiters.set(requirement, { resolve, reject }))
    worker.postMessage({ type: 'install', requirement })
    const result = await done
    if (result.ok && this.worker === worker) {
      this.bootedKey = configKey({ ...config, packages: [...config.packages, requirement] })
    }
    return result
  }

  /**
   * Request/reply to the worker: `scenario:<command>` (Greenfoot-style control, needs a scenario run) or a static
   * analysis (`model`, `check`). Waits for a boot in progress; with no worker at all the reply is an error.
   */
  async rpc<T = unknown>(name: string, ...args: unknown[]): Promise<RpcReply<T>> {
    if (this.boot) await this.boot.promise.catch(() => {})
    const worker = this.worker
    if (!worker || this.state.phase === 'booting') return { ok: false, error: t('run.state.idle') }
    const id = this.nextRpc++
    const reply = new Promise<RpcReply>((resolve) => this.rpcWaiters.set(id, resolve))
    worker.postMessage({ type: 'rpc', id, name, args })
    return reply as Promise<RpcReply<T>>
  }

  /** The page's sound output (mute switch), if the browser has one. */
  get audio(): AudioSink | undefined {
    return this.env.audio
  }

  /** The person typed a line for the waiting `input()` (null: give up). */
  answerInput(text: string | null): void {
    const request = this.state.input
    if (!request) return
    if (text !== null) this.log('input', request.prompt + text)
    this.set({ input: null })
    if (request.via === 'service-worker') {
      if (this.env.inputBase) this.env.replyToServiceWorker?.(this.env.inputBase, request.id, text)
    } else this.worker?.postMessage({ type: 'input-reply', id: request.id, text })
  }

  sendInput(event: InputEvent): void {
    if (this.state.phase === 'running') this.worker?.postMessage({ type: 'input', event })
  }

  /** The configuration key of the booted worker; used to detect that a project needs a different runtime. */
  isBootedFor(config: RuntimeConfig): boolean {
    return this.bootedKey === configKey(config) && this.worker !== null
  }

  dispose(): void {
    this.discardWorker(t('run.cancelled'))
    this.listeners.clear()
  }
}

function chain<T>(first: Waiter<T>, second: Waiter<T>): Waiter<T> {
  return {
    resolve: (v) => (first.resolve(v), second.resolve(v)),
    reject: (e) => (first.reject(e), second.reject(e)),
  }
}

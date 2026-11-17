/** Messages between the main thread and the Pyodide worker. Everything is structured-clonable. */

export type InputEvent =
  | { kind: 'keydown' | 'keyup'; key: number; mod: number; unicode: string }
  | { kind: 'mousedown' | 'mouseup'; x: number; y: number; button: number }
  | { kind: 'mousemove'; x: number; y: number; buttons: number }
  | { kind: 'wheel'; dx: number; dy: number }

/** `{ok, value}` or `{ok: false, error}`: same shape as miniworlds' ScenarioHost.dispatch. */
export type RpcReply<T = unknown> = { ok: true; value: T } | { ok: false; error: string }

export type BootStep = 'pyodide' | 'packages' | 'miniworlds' | 'extra'

export type ToWorker =
  | {
      type: 'boot'
      canvas: OffscreenCanvas
      pyodideBase: string
      /** Exact version, or null for the newest. */
      miniworlds: string | null
      packages: string[]
    }
  /** `scenario`: Greenfoot-style run, the world starts paused and answers `scenario:*` requests. */
  | { type: 'run'; files: Record<string, ArrayBuffer>; entry: string; scenario: boolean }
  | { type: 'stop' }
  | { type: 'input'; event: InputEvent }
  | { type: 'install'; requirement: string }
  /** Request/reply: scenario commands ("scenario:act") and static analysis ("model", "check"). */
  | { type: 'rpc'; id: number; name: string; args: unknown[] }

/** Files the program created, changed or deleted while it ran. */
export interface FileChanges {
  changed: Record<string, ArrayBuffer>
  deleted: string[]
}

export type FromWorker =
  | { type: 'progress'; step: BootStep }
  | { type: 'ready'; version: string }
  | { type: 'boot-error'; text: string }
  | { type: 'out'; stream: 'stdout' | 'stderr'; text: string }
  /** Something worth telling the user once (e.g. the program used sound, which the worker cannot play). */
  | { type: 'notice'; code: 'silent-audio' }
  /** The program ended by itself (world closed, script finished or crashed). `error` is the traceback if it crashed. */
  | ({ type: 'exit'; error: string | null } & FileChanges)
  | ({ type: 'stopped' } & FileChanges)
  | { type: 'installed'; requirement: string; ok: boolean; error?: string }
  /** Scenario mode: the world exists and is paused, commands are accepted. */
  | { type: 'scenario-ready' }
  | { type: 'rpc-result'; id: number; reply: RpcReply }

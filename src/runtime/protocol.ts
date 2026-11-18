/** Messages between the main thread and the Pyodide worker. Everything is structured-clonable. */

export type InputEvent =
  | { kind: 'keydown' | 'keyup'; key: number; mod: number; unicode: string }
  | { kind: 'mousedown' | 'mouseup'; x: number; y: number; button: number }
  | { kind: 'mousemove'; x: number; y: number; buttons: number }
  | { kind: 'wheel'; dx: number; dy: number }

/** `{ok, value}` or `{ok: false, error}`: same shape as miniworlds' ScenarioHost.dispatch. */
export type RpcReply<T = unknown> = { ok: true; value: T } | { ok: false; error: string }

import type { AudioMessage } from './audio'

export type BootStep = 'pyodide' | 'packages' | 'miniworlds' | 'extra'

export type ToWorker =
  | {
      type: 'boot'
      canvas: OffscreenCanvas
      pyodideBase: string
      /** Exact version, or null for the newest. */
      miniworlds: string | null
      packages: string[]
      /** Where the Service Worker answers a blocking read (Firefox, Safari); null without a Service Worker. */
      inputBase: string | null
      /** The page plays the program's sound (see audio.ts); without it sound is silenced. */
      audio: boolean
    }
  /** `scenario`: Greenfoot-style run, the world starts paused and answers `scenario:*` requests. */
  | { type: 'run'; files: Record<string, ArrayBuffer>; entry: string; scenario: boolean }
  | { type: 'stop' }
  | { type: 'input'; event: InputEvent }
  | { type: 'install'; requirement: string }
  /** The line for an `input()` request (`text` null: no more input, the program is ending). */
  | { type: 'input-reply'; id: string; text: string | null }
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
  /** `blocked`: the page's security policy refused Python's code (typically an old cached copy of the worker with an old policy). */
  | { type: 'boot-error'; text: string; hint?: 'blocked' }
  | { type: 'out'; stream: 'stdout' | 'stderr'; text: string }
  /** Something worth telling the user once (e.g. the program used sound, which the worker cannot play). */
  | { type: 'notice'; code: 'silent-audio' }
  /** The program plays sound or music: the page does it. */
  | ({ type: 'audio' } & AudioMessage)
  /** The program ended by itself (world closed, script finished or crashed). `error` is the traceback if it crashed. */
  | ({ type: 'exit'; error: string | null } & FileChanges)
  | ({ type: 'stopped' } & FileChanges)
  | { type: 'installed'; requirement: string; ok: boolean; error?: string }
  /** The program waits in `input()`. `via`: where the answer must go (to the worker, or to the Service Worker that holds a blocking request). */
  | { type: 'input-request'; id: string; prompt: string; via: 'worker' | 'service-worker' }
  /** Scenario mode: the world exists and is paused, commands are accepted. */
  | { type: 'scenario-ready' }
  | { type: 'rpc-result'; id: number; reply: RpcReply }

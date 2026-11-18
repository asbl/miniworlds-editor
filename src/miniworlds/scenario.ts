import type { RpcReply } from '../runtime/protocol'

/** Shapes returned by miniworlds' ScenarioHost (tools/scenario_host.py). */
export interface ActorInfo {
  handle: string
  cls: string
  x: number
  y: number
  direction: number
  size: [number, number]
}
export interface Snapshot {
  world: { cls: string; frame: number; paused: boolean; fps: number; speed: number }
  actors: ActorInfo[]
}
export interface Status {
  frame: number
  paused: boolean
  fps: number
  speed: number
  actors: number
  by_class: Record<string, number>
}
export interface ClassInfo {
  name: string
  base: string | null
  is_actor: boolean
}
export interface ParamInfo {
  name: string
  keyword_only: boolean
  required: boolean
  default: string | null
}
export interface MethodInfo {
  name: string
  origin: string
  params: ParamInfo[]
}
export interface Inspection {
  cls: string
  fields: Record<string, string>
  engine: Record<string, string>
}

/** The part of Runner that the client needs (a fake in tests). */
export interface RpcRunner {
  rpc<T = unknown>(name: string, ...args: unknown[]): Promise<RpcReply<T>>
}

export class ScenarioError extends Error {}

/** Typed access to the Greenfoot-style commands of the running world. Every method rejects with `ScenarioError`. */
export class ScenarioClient {
  constructor(private runner: RpcRunner) {}

  private async cmd<T>(name: string, ...args: unknown[]): Promise<T> {
    const reply = await this.runner.rpc<T>(`scenario:${name}`, ...args)
    if (!reply.ok) throw new ScenarioError(reply.error)
    return reply.value
  }

  act = (frames = 1) => this.cmd<void>('act', frames)
  run = () => this.cmd<void>('run')
  pause = () => this.cmd<void>('pause')
  setSpeed = (factor: number) => this.cmd<number>('speed', factor)
  status = () => this.cmd<Status>('status')
  snapshot = () => this.cmd<Snapshot>('snapshot')
  classes = () => this.cmd<ClassInfo[]>('classes')
  constructorParams = (cls: string) => this.cmd<ParamInfo[]>('constructor', cls)
  place = (cls: string, x: number, y: number, texts: string[] = []) => this.cmd<string>('place', cls, x, y, texts)
  pick = (x: number, y: number) => this.cmd<string | null>('pick', x, y)
  move = (handle: string, x: number, y: number) => this.cmd<void>('move', handle, x, y)
  remove = (handle: string) => this.cmd<void>('delete', handle)
  inspect = (handle: string) => this.cmd<Inspection>('inspect', handle)
  methods = (handle: string) => this.cmd<MethodInfo[]>('methods', handle)
  call = (handle: string, method: string, texts: string[]) => this.cmd<{ result: string | null }>('call', handle, method, texts)
  exportCode = () => this.cmd<string>('export_code')
}

/** Speed slider: index -3…3 → 1/8×…8× (powers of two, like the old client). */
export const SPEED_MIN = -3
export const SPEED_MAX = 3
export const speedFactor = (index: number) => 2 ** Math.max(SPEED_MIN, Math.min(SPEED_MAX, index))
export function speedLabel(index: number): string {
  const f = speedFactor(index)
  return f >= 1 ? `${f}×` : `1/${Math.round(1 / f)}×`
}

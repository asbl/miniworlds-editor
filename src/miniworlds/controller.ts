import { EMPTY_FACTS, type Facts } from '../tasks/checks'
import { FactTracker } from '../tasks/facts'
import { append, fromWorld, keyFor, replay, roundPoint, type Op } from './journal'
import type { MiniworldsMeta } from './meta'
import { speedFactor, SPEED_MAX, SPEED_MIN, type ActorInfo, type ClassInfo, type Inspection, type MethodInfo, type ParamInfo, type ScenarioClient } from './scenario'

/** Dialogs the controller needs; the UI layer provides them (tests use scripted answers). */
export interface MiniworldsUi {
  /**
   * Ask for the values of `params` (constructor or method arguments). Resolves with the texts, or null when cancelled.
   * `validate` runs on submit and may keep the dialog open by returning an error text.
   */
  askValues(request: { title: string; params: ParamInfo[]; submit: 'create' | 'call'; validate?: (texts: string[]) => Promise<string | null> }): Promise<string[] | null>
}

export interface MiniworldsEnv {
  getMeta(): MiniworldsMeta
  setMeta(meta: MiniworldsMeta): void
  /** Message for the console. */
  note(text: string, kind?: 'system' | 'stderr'): void
  ui: MiniworldsUi
  /** Texts for notes (the controller does not know the language). */
  text(key: 'replayed' | 'replayedSkipped' | 'setupKept', params?: Record<string, string | number>): string
}

export interface MiniworldsState {
  /** The scenario world exists and answers commands. */
  active: boolean
  frame: number
  paused: boolean
  fps: number
  speedIndex: number
  actors: number
  byClass: Record<string, number>
  classes: ClassInfo[]
  selected: ActorInfo | null
  /** The selected actor's fields, kept up to date while the world runs (null: nothing selected). */
  inspection: Inspection | null
  /** Every actor; filled only while the guide lines need them (`setGuides`). */
  actorList: ActorInfo[]
  /** What happened in the world since it started (for the tasks' automatic checks). */
  facts: Facts
  armed: { cls: string; args: string[] } | null
  /** An edit after the first frame happened: it is not part of the start setup. */
  lateEdit: boolean
}

const INITIAL: MiniworldsState = {
  active: false,
  frame: 0,
  paused: true,
  fps: 60,
  speedIndex: 0,
  actors: 0,
  byClass: {},
  classes: [],
  selected: null,
  inspection: null,
  actorList: [],
  facts: EMPTY_FACTS,
  armed: null,
  lateEdit: false,
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * The Greenfoot-style behaviour on top of a running world: act/run/pause, placing, dragging, deleting, calling
 * methods, and recording the hand-made start setup. No DOM, no framework; components render `state`.
 */
export class MiniworldsController {
  state: MiniworldsState = { ...INITIAL }
  private listeners = new Set<() => void>()
  private drag: { handle: string; dx: number; dy: number; pending: [number, number] | null; inflight: boolean; moved: boolean } | null = null
  private busy = false
  private guides = false
  private trackMoves = false
  private tracker = new FactTracker()
  /** The primary button is down: a quick tap can release it while `pickAt` is still answering. */
  private pressed = false

  constructor(
    private client: ScenarioClient,
    private env: MiniworldsEnv,
  ) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  private set(patch: Partial<MiniworldsState>): void {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((l) => l())
  }

  /** Editor interactions (place, drag, menus) only while the world is paused; a running world owns the input. */
  get interactive(): boolean {
    return this.state.active && this.state.paused && !this.busy
  }

  get setupSteps(): number {
    return this.env.getMeta().journal.length
  }

  // ---- lifecycle ----

  /** The world is ready (paused, frame 0): load the classes and replay the remembered start setup. */
  async onReady(): Promise<void> {
    this.busy = true
    try {
      const classes = await this.client.classes()
      this.tracker.reset()
      this.set({ ...INITIAL, active: true, classes, speedIndex: this.state.speedIndex })
      await this.client.setSpeed(speedFactor(this.state.speedIndex))
      const journal = this.env.getMeta().journal
      if (journal.length > 0) {
        const result = await replay(this.client, journal)
        this.env.note(
          result.failed
            ? this.env.text('replayedSkipped', { done: result.total - result.failed, total: result.total, failed: result.failed, reason: result.firstError })
            : this.env.text('replayed', { done: result.total, total: result.total }),
        )
      }
    } catch (error) {
      this.env.note(messageOf(error), 'stderr')
    } finally {
      this.busy = false
    }
    await this.poll()
  }

  /** The program ended or was stopped. */
  onEnded(): void {
    this.drag = null
    this.set({ ...INITIAL, speedIndex: this.state.speedIndex, classes: this.state.classes, facts: this.tracker.facts }) // the facts of the last run stay (a task done is done)
  }

  /** Cheap status refresh; also keeps the selection box in place. */
  async poll(): Promise<void> {
    if (!this.state.active || this.busy) return
    try {
      const s = await this.client.status()
      this.tracker.status(s.by_class, s.frame)
      const patch: Partial<MiniworldsState> = { frame: s.frame, paused: s.paused, fps: s.fps, actors: s.actors, byClass: s.by_class, facts: this.tracker.facts }
      this.set(patch)
      await this.refreshWatch()
    } catch {
      /* the world ended in between; onEnded follows */
    }
  }

  /** Task checks that look at movement need the actors' positions at every poll. */
  setTrackMoves(on: boolean): void {
    this.trackMoves = on
  }

  /** The guide lines (hit boxes, directions) need every actor; they ask for it here. */
  setGuides(on: boolean): void {
    this.guides = on
    if (!on && this.state.actorList.length > 0) this.set({ actorList: [] })
    else if (on) void this.poll()
  }

  /**
   * Keeps what the UI watches fresh: the selected actor (box and live fields, also while the world runs) and, with guides
   * on, all actors. One snapshot serves both; nothing is fetched when nothing is watched.
   */
  private async refreshWatch(): Promise<void> {
    const sel = this.state.selected
    if (!sel && !this.guides && !this.trackMoves) {
      if (this.state.actorList.length > 0 || this.state.inspection) this.set({ actorList: [], inspection: null })
      return
    }
    const { actors } = await this.client.snapshot()
    if (this.trackMoves) this.tracker.actors(actors, this.state.frame)
    const selected = sel ? (actors.find((a) => a.handle === sel.handle) ?? null) : null
    let inspection: Inspection | null = null
    if (selected) {
      try {
        inspection = await this.client.inspect(selected.handle)
      } catch {
        /* the actor vanished between the two calls; the next poll clears the selection */
      }
    }
    if (selected && this.tracker.selected(selected.cls)) this.set({ facts: this.tracker.facts })
    this.set({ selected, inspection, actorList: this.guides ? actors : [], facts: this.tracker.facts })
  }

  // ---- run control ----

  async act(): Promise<void> {
    await this.client.act(1)
    this.set({ armed: null })
    await this.poll()
  }

  async togglePause(): Promise<void> {
    if (this.state.paused) {
      this.set({ armed: null }) // the selection stays: the inspector follows the actor while the world runs
      await this.client.run()
    } else {
      await this.client.pause()
    }
    await this.poll()
  }

  async setSpeedIndex(index: number): Promise<void> {
    const clamped = Math.max(SPEED_MIN, Math.min(SPEED_MAX, Math.round(index)))
    this.set({ speedIndex: clamped })
    if (this.state.active) await this.client.setSpeed(speedFactor(clamped))
  }

  // ---- recording the start setup ----

  private async record(op: Op): Promise<void> {
    const { frame } = await this.client.status()
    if (frame !== 0) return void this.set({ lateEdit: true })
    this.env.setMeta({ ...this.env.getMeta(), journal: append(this.env.getMeta().journal, op) })
  }

  private async recordWithKey(handle: string, op: (key: { cls: string; n: number }) => Op): Promise<void> {
    const { actors } = await this.client.snapshot()
    const key = keyFor(actors, handle)
    if (key) await this.record(op(key))
  }

  /** "Als Start merken": the current world becomes the start setup. */
  async keepSetup(): Promise<void> {
    const journal = await fromWorld(this.client)
    this.env.setMeta({ ...this.env.getMeta(), journal })
    this.set({ lateEdit: false })
    this.env.note(this.env.text('setupKept', { count: journal.length - 1 }))
  }

  clearSetup(): void {
    this.env.setMeta({ ...this.env.getMeta(), journal: [] })
    this.set({ lateEdit: false })
  }

  // ---- placing ----

  /** Ask for constructor values once, then arm the class: the next click in the world creates an object. */
  async arm(cls: string | null): Promise<void> {
    if (cls === null) return void this.set({ armed: null })
    try {
      const params = await this.client.constructorParams(cls)
      let args: string[] = []
      if (params.length > 0) {
        const answer = await this.env.ui.askValues({ title: `${cls}(…)`, params, submit: 'create' })
        if (answer === null) return
        args = answer
      }
      if (!this.state.paused) await this.client.pause()
      this.set({ armed: { cls, args }, paused: true })
    } catch (error) {
      this.env.note(messageOf(error), 'stderr')
    }
  }

  async placeAt(cls: string, x: number, y: number, args: string[] = []): Promise<string | null> {
    try {
      const handle = await this.client.place(cls, x, y, args)
      const [rx, ry] = roundPoint(x, y)
      await this.record({ op: 'place', cls, x: rx, y: ry, args: [...args] })
      await this.select(handle)
      await this.poll()
      return handle
    } catch (error) {
      this.env.note(messageOf(error), 'stderr')
      return null
    }
  }

  /** "Neu Klasse" from the world's context menu: ask for constructor values, then create right there. */
  async createAt(cls: string, x: number, y: number): Promise<void> {
    const params = await this.client.constructorParams(cls)
    const args = params.length ? await this.env.ui.askValues({ title: `${cls}(…)`, params, submit: 'create' }) : []
    if (args !== null) await this.placeAt(cls, x, y, args)
  }

  /** Select an actor by handle (or clear the selection). */
  async select(handle: string | null): Promise<void> {
    if (!handle) return void this.set({ selected: null, inspection: null })
    const { actors } = await this.client.snapshot()
    this.set({ selected: actors.find((a) => a.handle === handle) ?? null })
    if (!this.drag) await this.refreshWatch() // fields right away, not at the next poll
  }

  async pickAt(x: number, y: number): Promise<ActorInfo | null> {
    const handle = await this.client.pick(x, y)
    if (!handle) return null
    const { actors } = await this.client.snapshot()
    return actors.find((a) => a.handle === handle) ?? null
  }

  // ---- pointer interaction (coordinates are world pixels) ----

  /** Left button pressed on the world. Returns true when the editor handled it (so the game does not get it). */
  async pointerDown(x: number, y: number, shift = false): Promise<boolean> {
    if (!this.interactive) return false
    const armed = this.state.armed
    if (armed) {
      await this.placeAt(armed.cls, x, y, armed.args)
      if (!shift) this.set({ armed: null })
      return true
    }
    this.pressed = true
    const actor = await this.pickAt(x, y)
    this.set({ selected: actor, ...(actor ? {} : { inspection: null }) })
    this.drag = actor && this.pressed ? { handle: actor.handle, dx: x - actor.x, dy: y - actor.y, pending: null, inflight: false, moved: false } : null
    return true
  }

  pointerMove(x: number, y: number): void {
    const d = this.drag
    if (!d) return
    d.pending = [x - d.dx, y - d.dy]
    d.moved = true
    if (!d.inflight) void this.flushDrag(d)
  }

  /** Sends pending positions one at a time, so moves never overlap and the last one wins. */
  private async flushDrag(d: NonNullable<MiniworldsController['drag']>): Promise<void> {
    d.inflight = true
    try {
      while (d.pending) {
        const [x, y] = d.pending
        d.pending = null
        await this.client.move(d.handle, x, y)
        await this.select(d.handle)
      }
    } catch (error) {
      this.env.note(messageOf(error), 'stderr')
    } finally {
      d.inflight = false
    }
  }

  async pointerUp(): Promise<void> {
    this.pressed = false
    const d = this.drag
    this.drag = null
    if (!d) return
    const last = d.pending
    if (last) await this.client.move(d.handle, last[0], last[1])
    while (d.inflight) await new Promise((r) => setTimeout(r, 0))
    const a = (await this.client.snapshot()).actors.find((x) => x.handle === d.handle)
    if (!a) return
    // only a real drag is a step; a plain click selects
    if (d.moved) {
      const [rx, ry] = roundPoint(a.x, a.y)
      await this.recordWithKey(d.handle, (key) => ({ op: 'move', cls: key.cls, n: key.n, x: rx, y: ry }))
    }
    await this.select(d.handle)
  }

  // ---- context menu actions ----

  async removeActor(handle: string): Promise<void> {
    try {
      await this.recordWithKey(handle, (key) => ({ op: 'delete', cls: key.cls, n: key.n })) // key before the actor is gone
      await this.client.remove(handle)
      if (this.state.selected?.handle === handle) this.set({ selected: null, inspection: null })
      await this.poll()
    } catch (error) {
      this.env.note(messageOf(error), 'stderr')
    }
  }

  async methodsOf(handle: string): Promise<MethodInfo[]> {
    try {
      return await this.client.methods(handle)
    } catch (error) {
      this.env.note(messageOf(error), 'stderr')
      return []
    }
  }

  /** Call a method of an actor (asking for arguments if it has parameters). */
  async invokeMethod(handle: string, method: MethodInfo): Promise<void> {
    const run = async (texts: string[]): Promise<string | null> => {
      try {
        const reply = await this.client.call(handle, method.name, texts)
        await this.recordWithKey(handle, (key) => ({ op: 'call', cls: key.cls, n: key.n, method: method.name, texts: [...texts] }))
        if (this.tracker.called(method.name)) this.set({ facts: this.tracker.facts })
        const shown = `${method.name}(${texts.filter(Boolean).join(', ')})`
        this.env.note(reply.result != null ? `${shown} → ${reply.result}` : shown)
        await this.poll()
        return null
      } catch (error) {
        return messageOf(error)
      }
    }
    if (method.params.length === 0) {
      const problem = await run([])
      if (problem) this.env.note(`${method.name}: ${problem}`, 'stderr')
      return
    }
    await this.env.ui.askValues({ title: `${method.origin}.${method.name}`, params: method.params, submit: 'call', validate: run })
  }

  async inspect(handle: string): Promise<Inspection | null> {
    try {
      return await this.client.inspect(handle)
    } catch (error) {
      this.env.note(messageOf(error), 'stderr')
      return null
    }
  }

  async exportCode(): Promise<string> {
    return this.client.exportCode()
  }
}

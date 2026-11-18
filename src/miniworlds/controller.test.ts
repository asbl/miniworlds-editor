import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MiniworldsController, type MiniworldsEnv } from './controller'
import { fakeWorld } from './fakeWorld'
import { emptyMeta, type MiniworldsMeta } from './meta'
import type { ScenarioClient } from './scenario'

function setup(initial: Array<[string, number, number]> = [], meta: MiniworldsMeta = emptyMeta()) {
  const w = fakeWorld(initial, [
    { name: 'Krabbe', base: 'Circle', is_actor: true },
    { name: 'Spielfeld', base: 'World', is_actor: false },
  ])
  let current = meta
  const notes: string[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ask = vi.fn<(request: any) => Promise<string[] | null>>(async () => [])
  const env: MiniworldsEnv = {
    getMeta: () => current,
    setMeta: (m) => void (current = m),
    note: (t) => void notes.push(t),
    ui: { askValues: ask as never },
    text: (key, p) => `${key}:${JSON.stringify(p ?? {})}`,
  }
  const controller = new MiniworldsController(w.client as unknown as ScenarioClient, env)
  return { w, controller, notes, ask, meta: () => current }
}

describe('MiniworldsController', () => {
  let t: ReturnType<typeof setup>
  beforeEach(async () => {
    t = setup()
    await t.controller.onReady()
  })

  it('becomes active with the user classes', () => {
    expect(t.controller.state).toMatchObject({ active: true, paused: true, frame: 0 })
    expect(t.controller.state.classes.map((c) => c.name)).toEqual(['Krabbe', 'Spielfeld'])
    expect(t.controller.interactive).toBe(true)
  })

  it('act advances one frame and stays paused; run/pause toggles', async () => {
    await t.controller.act()
    expect(t.controller.state.frame).toBe(1)
    await t.controller.togglePause()
    expect(t.controller.state.paused).toBe(false)
    expect(t.controller.interactive).toBe(false)
    await t.controller.togglePause()
    expect(t.controller.state.paused).toBe(true)
  })

  it('speed is clamped and sent as a factor', async () => {
    await t.controller.setSpeedIndex(9)
    expect(t.controller.state.speedIndex).toBe(3)
    expect(t.w.state.speed).toBe(8)
    await t.controller.setSpeedIndex(-1)
    expect(t.w.state.speed).toBe(0.5)
  })

  it('armed class places on the next click and records the step; shift keeps it armed', async () => {
    await t.controller.arm('Krabbe')
    expect(t.controller.state.armed).toEqual({ cls: 'Krabbe', args: [] })
    expect(await t.controller.pointerDown(100.456, 50, true)).toBe(true)
    expect(t.w.actors).toHaveLength(1)
    expect(t.controller.state.armed).not.toBeNull()
    await t.controller.pointerDown(10, 10)
    expect(t.controller.state.armed).toBeNull()
    expect(t.meta().journal).toEqual([
      { op: 'place', cls: 'Krabbe', x: 100.46, y: 50, args: [] },
      { op: 'place', cls: 'Krabbe', x: 10, y: 10, args: [] },
    ])
    expect(t.controller.state.selected?.cls).toBe('Krabbe')
  })

  it('asks constructor values once when arming; cancelling does not arm', async () => {
    t.w.params.Krabbe = [{ name: 'radius', keyword_only: false, required: false, default: '8' }]
    t.ask.mockResolvedValueOnce(null)
    await t.controller.arm('Krabbe')
    expect(t.controller.state.armed).toBeNull()
    t.ask.mockResolvedValueOnce(['16'])
    await t.controller.arm('Krabbe')
    expect(t.controller.state.armed).toEqual({ cls: 'Krabbe', args: ['16'] })
    await t.controller.pointerDown(1, 1)
    expect(t.w.state.log).toContain('place Krabbe 16')
    expect(t.meta().journal[0]).toMatchObject({ args: ['16'] })
  })

  it('dragging moves the actor and records one merged move', async () => {
    t.w.add('Krabbe', 100, 100)
    await t.controller.pointerDown(105, 100) // grab 5px right of the center
    expect(t.controller.state.selected?.cls).toBe('Krabbe')
    t.controller.pointerMove(120, 100)
    t.controller.pointerMove(155, 130)
    await t.controller.pointerUp()
    expect(t.w.actors[0]).toMatchObject({ x: 150, y: 130 })
    expect(t.meta().journal).toEqual([{ op: 'move', cls: 'Krabbe', n: 0, x: 150, y: 130 }])
  })

  it('a plain click selects without recording', async () => {
    t.w.add('Krabbe', 100, 100)
    await t.controller.pointerDown(100, 100)
    await t.controller.pointerUp()
    expect(t.meta().journal).toEqual([])
    expect(t.controller.state.selected?.cls).toBe('Krabbe')
  })

  it('a tap released before the pick answers selects but does not leave a drag behind', async () => {
    const krabbe = t.w.add('Krabbe', 100, 100)
    const down = t.controller.pointerDown(100, 100)
    await t.controller.pointerUp() // released while pick is still pending
    await down
    expect(t.controller.state.selected?.cls).toBe('Krabbe')
    t.controller.pointerMove(200, 200)
    await t.controller.pointerUp()
    expect(t.w.actors[0]).toMatchObject({ x: krabbe.x, y: krabbe.y })
  })

  it('clicking empty space clears the selection', async () => {
    t.w.add('Krabbe', 100, 100)
    await t.controller.pointerDown(100, 100)
    await t.controller.pointerUp()
    await t.controller.pointerDown(300, 300)
    expect(t.controller.state.selected).toBeNull()
  })

  it('does not take input while the world runs', async () => {
    await t.controller.togglePause()
    expect(await t.controller.pointerDown(5, 5)).toBe(false)
  })

  it('deleting records the key before the actor is gone', async () => {
    t.w.add('Krabbe', 1, 1)
    const wurm = t.w.add('Krabbe', 2, 2)
    await t.controller.removeActor(wurm.handle)
    expect(t.w.actors).toHaveLength(1)
    expect(t.meta().journal).toEqual([{ op: 'delete', cls: 'Krabbe', n: 1 }])
  })

  it('edits after the first frame are not recorded and flagged', async () => {
    await t.controller.act()
    await t.controller.placeAt('Krabbe', 5, 5)
    expect(t.meta().journal).toEqual([])
    expect(t.controller.state.lateEdit).toBe(true)
    await t.controller.keepSetup() // takes over the current world
    expect(t.meta().journal).toEqual([{ op: 'clear' }, { op: 'place', cls: 'Krabbe', x: 5, y: 5 }])
    expect(t.controller.state.lateEdit).toBe(false)
  })

  it('method calls without parameters run directly and are recorded', async () => {
    const a = t.w.add('Krabbe', 1, 1)
    await t.controller.invokeMethod(a.handle, { name: 'fressen', origin: 'Krabbe', params: [] })
    expect(t.w.state.log).toContain(`call ${a.handle}.fressen()`)
    expect(t.meta().journal).toEqual([{ op: 'call', cls: 'Krabbe', n: 0, method: 'fressen', texts: [] }])
    expect(t.notes.at(-1)).toBe('fressen()')
  })

  it('method calls with parameters go through the dialog validator, which keeps the dialog open on errors', async () => {
    const a = t.w.add('Krabbe', 1, 1)
    let outcome: (string | null)[] = []
    t.ask.mockImplementationOnce(async (req: { validate: (t: string[]) => Promise<string | null> }) => {
      outcome.push(await req.validate(['3']))
      return ['3']
    })
    await t.controller.invokeMethod(a.handle, { name: 'fressen', origin: 'Krabbe', params: [{ name: 'menge', keyword_only: false, required: false, default: '1' }] })
    expect(outcome).toEqual([null])
    expect(t.w.state.log).toContain(`call ${a.handle}.fressen(3)`)
    // an engine error is returned to the dialog instead of being thrown
    t.w.actors.length = 0
    outcome = []
    t.ask.mockImplementationOnce(async (req: { validate: (t: string[]) => Promise<string | null> }) => {
      outcome.push(await req.validate(['3']))
      return null
    })
    await t.controller.invokeMethod(a.handle, { name: 'fressen', origin: 'Krabbe', params: [{ name: 'menge', keyword_only: false, required: false, default: '1' }] })
    expect(outcome[0]).toMatch(/existiert nicht mehr/)
  })

  it('ending the program resets the state but keeps classes and speed', async () => {
    await t.controller.setSpeedIndex(2)
    t.controller.onEnded()
    expect(t.controller.state).toMatchObject({ active: false, speedIndex: 2 })
    expect(t.controller.state.classes).toHaveLength(2)
    expect(t.controller.interactive).toBe(false)
  })
  describe('live inspection and guides', () => {
    it('the selection follows the actor while the world runs and shows its fields', async () => {
      const krabbe = t.w.add('Krabbe', 100, 100)
      await t.controller.select(krabbe.handle)
      expect(t.controller.state.inspection?.fields).toEqual({ zaehler: '3' })
      await t.controller.togglePause() // run: the selection stays
      expect(t.controller.state.selected?.handle).toBe(krabbe.handle)
      krabbe.x = 140
      await t.controller.poll()
      expect(t.controller.state.selected?.x).toBe(140)
      expect(t.controller.state.paused).toBe(false)
    })

    it('the selection ends when the actor is gone', async () => {
      const krabbe = t.w.add('Krabbe', 100, 100)
      await t.controller.select(krabbe.handle)
      t.w.actors.splice(0, 1)
      await t.controller.poll()
      expect(t.controller.state.selected).toBeNull()
      expect(t.controller.state.inspection).toBeNull()
    })

    it('asks the world for every actor only while guides are on', async () => {
      t.w.add('Krabbe', 10, 10)
      t.w.add('Krabbe', 20, 20)
      const snapshot = vi.spyOn(t.w.client, 'snapshot')
      await t.controller.poll()
      expect(snapshot).not.toHaveBeenCalled()
      expect(t.controller.state.actorList).toEqual([])
      t.controller.setGuides(true)
      await vi.waitFor(() => expect(t.controller.state.actorList).toHaveLength(2))
      t.controller.setGuides(false)
      expect(t.controller.state.actorList).toEqual([])
    })
  })
})

describe('MiniworldsController start setup', () => {
  it('replays the journal when the world is ready and says so', async () => {
    const t = setup([], { journal: [{ op: 'place', cls: 'Krabbe', x: 10, y: 10 }, { op: 'move', cls: 'Wurm', n: 0, x: 1, y: 1 }], tasks: [], tasksDone: {} })
    await t.controller.onReady()
    expect(t.w.actors.map((a) => a.cls)).toEqual(['Krabbe'])
    expect(t.notes[0]).toMatch(/^replayedSkipped:.*"done":1.*"failed":1/)
  })

  it('clearSetup empties the journal', async () => {
    const t = setup([], { journal: [{ op: 'clear' }], tasks: [], tasksDone: {} })
    await t.controller.onReady()
    t.controller.clearSetup()
    expect(t.meta().journal).toEqual([])
  })

})

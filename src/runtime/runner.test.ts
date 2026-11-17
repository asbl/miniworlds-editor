import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FromWorker, ToWorker } from './protocol'
import { Runner, type CanvasLike, type WorkerLike } from './runner'

class FakeWorker implements WorkerLike {
  sent: ToWorker[] = []
  terminated = false
  onmessage: WorkerLike['onmessage'] = null
  onerror: WorkerLike['onerror'] = null
  postMessage(message: ToWorker) {
    this.sent.push(message)
  }
  terminate() {
    this.terminated = true
  }
  emit(message: FromWorker) {
    this.onmessage?.({ data: message })
  }
  last<T extends ToWorker['type']>(type: T) {
    return this.sent.filter((m) => m.type === type).at(-1) as Extract<ToWorker, { type: T }>
  }
}

const tick = () => Promise.resolve().then(() => Promise.resolve())

function setup() {
  const workers: FakeWorker[] = []
  let canvases = 0
  const runner = new Runner<CanvasLike>({
    pyodideBase: 'https://example.test/pyodide/',
    createWorker: () => {
      const w = new FakeWorker()
      workers.push(w)
      return w
    },
    createCanvas: () => (canvases++, { transferControlToOffscreen: () => ({}) as OffscreenCanvas }),
  })
  return { runner, workers, canvasCount: () => canvases }
}

const config = { miniworlds: '4.4.0.16', packages: [] as string[] }
const bootReady = async (runner: Runner<CanvasLike>, workers: FakeWorker[], cfg = config) => {
  const p = runner.ensureBooted(cfg)
  workers.at(-1)?.emit({ type: 'ready', version: cfg.miniworlds ?? '9.9.9' })
  await p
}

describe('Runner', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('boots once for the same configuration and reuses the worker', async () => {
    const { runner, workers } = setup()
    const first = runner.ensureBooted(config)
    expect(runner.state.phase).toBe('booting')
    expect(workers[0]?.last('boot')).toMatchObject({ miniworlds: '4.4.0.16', packages: [], pyodideBase: 'https://example.test/pyodide/' })
    workers[0]?.emit({ type: 'progress', step: 'miniworlds' })
    expect(runner.state.bootStep).toBe('miniworlds')
    workers[0]?.emit({ type: 'ready', version: '4.4.0.16' })
    await first
    expect(runner.state).toMatchObject({ phase: 'ready', version: '4.4.0.16' })
    await runner.ensureBooted({ ...config, packages: [] })
    expect(workers).toHaveLength(1)
  })

  it('restarts the worker and uses a fresh canvas when the configuration changes', async () => {
    const { runner, workers, canvasCount } = setup()
    await bootReady(runner, workers)
    const gen = runner.state.canvasGeneration
    const second = runner.ensureBooted({ ...config, packages: ['requests'] })
    expect(workers[0]?.terminated).toBe(true)
    expect(workers).toHaveLength(2)
    expect(workers[1]?.last('boot').packages).toEqual(['requests'])
    expect(canvasCount()).toBe(3) // initial placeholder + one per worker
    expect(runner.state.canvasGeneration).toBeGreaterThan(gen)
    workers[1]?.emit({ type: 'ready', version: '4.4.0.16' })
    await second
  })

  it('runs a program, collects output and reports a crash', async () => {
    const { runner, workers } = setup()
    await bootReady(runner, workers)
    const result = runner.run({ 'main.py': new TextEncoder().encode('print(1)') }, 'main.py', config)
    await tick()
    expect(runner.state.phase).toBe('running')
    const run = workers[0]?.last('run')
    expect(run?.entry).toBe('main.py')
    expect(Object.keys(run?.files ?? {})).toEqual(['main.py'])
    workers[0]?.emit({ type: 'out', stream: 'stdout', text: 'hello' })
    workers[0]?.emit({ type: 'exit', error: 'Traceback…\nValueError: x', changed: { 'a.json': new ArrayBuffer(2) }, deleted: ['old.txt'] })
    const r = await result
    expect(r.error).toContain('ValueError')
    expect(r.stopped).toBe(false)
    expect(Object.keys(r.changed)).toEqual(['a.json'])
    expect(r.deleted).toEqual(['old.txt'])
    expect(runner.state.phase).toBe('ready')
    const texts = runner.state.lines.map((l) => `${l.kind}:${l.text}`)
    expect(texts).toContain('stdout:hello')
    expect(texts.some((t) => t.startsWith('stderr:Traceback'))).toBe(true)
  })

  it('does not consume the caller\'s byte arrays when sending files', async () => {
    const { runner, workers } = setup()
    await bootReady(runner, workers)
    const bytes = new Uint8Array([1, 2, 3])
    void runner.run({ 'x.bin': bytes }, 'x.bin', config)
    await tick()
    expect(bytes.byteLength).toBe(3)
  })

  it('stop answers via the worker', async () => {
    const { runner, workers } = setup()
    await bootReady(runner, workers)
    const result = runner.run({}, 'main.py', config)
    await tick()
    const stopping = runner.stop()
    expect(runner.state.phase).toBe('stopping')
    expect(workers[0]?.sent.at(-1)).toEqual({ type: 'stop' })
    workers[0]?.emit({ type: 'stopped', changed: {}, deleted: [] })
    await stopping
    expect((await result).stopped).toBe(true)
    expect(runner.state.phase).toBe('ready')
    expect(workers[0]?.terminated).toBe(false)
  })

  it('terminates a worker that does not answer stop (endless loop)', async () => {
    const { runner, workers } = setup()
    await bootReady(runner, workers)
    const result = runner.run({}, 'main.py', config)
    await tick()
    const stopping = runner.stop()
    await vi.advanceTimersByTimeAsync(2000)
    await stopping
    expect((await result).stopped).toBe(true)
    expect(workers[0]?.terminated).toBe(true)
    expect(runner.state.phase).toBe('idle')
    expect(runner.state.lines.some((l) => l.kind === 'stderr')).toBe(true)
    // the next run boots a new worker
    void runner.run({}, 'main.py', config)
    expect(workers).toHaveLength(2)
  })

  it('a second stop() while stopping resolves too', async () => {
    const { runner, workers } = setup()
    await bootReady(runner, workers)
    void runner.run({}, 'main.py', config)
    await tick()
    const a = runner.stop()
    const b = runner.stop()
    workers[0]?.emit({ type: 'stopped', changed: {}, deleted: [] })
    await Promise.all([a, b])
  })

  it('reports boot errors and returns to idle', async () => {
    const { runner, workers } = setup()
    const boot = runner.ensureBooted(config)
    workers[0]?.emit({ type: 'boot-error', text: 'AbortError: Failed to fetch' })
    await expect(boot).rejects.toThrow('AbortError')
    expect(runner.state.phase).toBe('idle')
    expect(workers[0]?.terminated).toBe(true)
    expect(runner.state.lines.at(-1)?.text).toContain('AbortError')
  })

  it('cancelling during boot terminates the worker', async () => {
    const { runner, workers } = setup()
    const boot = runner.ensureBooted(config)
    await runner.stop()
    await expect(boot).rejects.toThrow()
    expect(workers[0]?.terminated).toBe(true)
    expect(runner.state.phase).toBe('idle')
  })

  it('a crashing worker ends the run and resets', async () => {
    const { runner, workers } = setup()
    await bootReady(runner, workers)
    const result = runner.run({}, 'main.py', config)
    await tick()
    workers[0]?.onerror?.({ message: 'out of memory' })
    expect((await result).stopped).toBe(true)
    expect(runner.state.phase).toBe('idle')
    expect(runner.state.lines.at(-1)?.text).toContain('out of memory')
  })

  it('ignores messages of a worker that was already replaced', async () => {
    const { runner, workers } = setup()
    await bootReady(runner, workers)
    const old = workers[0] as FakeWorker
    const next = runner.ensureBooted({ ...config, miniworlds: '4.3.0.1' })
    old.emit({ type: 'out', stream: 'stdout', text: 'ghost' })
    workers[1]?.emit({ type: 'ready', version: '4.3.0.1' })
    await next
    expect(runner.state.lines.some((l) => l.text === 'ghost')).toBe(false)
  })

  it('installs a package through the worker', async () => {
    const { runner, workers } = setup()
    await bootReady(runner, workers)
    const result = runner.install('requests', config)
    await tick()
    expect(workers[0]?.last('install')).toEqual({ type: 'install', requirement: 'requests' })
    workers[0]?.emit({ type: 'installed', requirement: 'requests', ok: false, error: 'no wheel' })
    expect(await result).toEqual({ ok: false, error: 'no wheel' })
  })

  it('an installed package does not force a restart when it is added to the project', async () => {
    const { runner, workers } = setup()
    await bootReady(runner, workers)
    const installing = runner.install('requests', config)
    await tick()
    workers[0]?.emit({ type: 'installed', requirement: 'requests', ok: true })
    await installing
    expect(runner.isBootedFor({ ...config, packages: ['requests'] })).toBe(true)
    await runner.ensureBooted({ ...config, packages: ['requests'] })
    expect(workers).toHaveLength(1)
    // removing it again needs a clean interpreter
    void runner.ensureBooted(config)
    expect(workers).toHaveLength(2)
  })

  it('starts a scenario run and reports readiness', async () => {
    const { runner, workers } = setup()
    await bootReady(runner, workers)
    void runner.run({}, 'main.py', config, { scenario: true })
    await tick()
    expect(workers[0]?.last('run').scenario).toBe(true)
    expect(runner.state).toMatchObject({ mode: 'scenario', scenarioReady: false })
    workers[0]?.emit({ type: 'scenario-ready' })
    expect(runner.state.scenarioReady).toBe(true)
    workers[0]?.emit({ type: 'exit', error: null, changed: {}, deleted: [] })
    expect(runner.state.scenarioReady).toBe(false)
  })

  it('answers rpc calls by id and fails pending ones when the worker goes away', async () => {
    const { runner, workers } = setup()
    await bootReady(runner, workers)
    const first = runner.rpc('scenario:act', 1)
    const second = runner.rpc('model', {})
    await tick()
    const sent = workers[0]?.sent.filter((m) => m.type === 'rpc') as Extract<ToWorker, { type: 'rpc' }>[]
    expect(sent.map((m) => m.name)).toEqual(['scenario:act', 'model'])
    workers[0]?.emit({ type: 'rpc-result', id: sent[1]?.id as number, reply: { ok: true, value: 'M' } })
    expect(await second).toEqual({ ok: true, value: 'M' })
    runner.restart()
    expect(await first).toMatchObject({ ok: false })
  })

  it('rpc without a worker is an error, not a hang', async () => {
    const { runner } = setup()
    expect(await runner.rpc('model', {})).toMatchObject({ ok: false })
  })

  it('forwards input only while a program runs', async () => {
    const { runner, workers } = setup()
    await bootReady(runner, workers)
    const e = { kind: 'keydown', key: 97, mod: 0, unicode: 'a' } as const
    runner.sendInput(e)
    expect(workers[0]?.sent.some((m) => m.type === 'input')).toBe(false)
    void runner.run({}, 'main.py', config)
    await tick()
    runner.sendInput(e)
    expect(workers[0]?.sent.at(-1)).toEqual({ type: 'input', event: e })
  })

  it('tells the user once-per-message that sound is silent', async () => {
    const { runner, workers } = setup()
    await bootReady(runner, workers)
    workers[0]?.emit({ type: 'notice', code: 'silent-audio' })
    expect(runner.state.lines.at(-1)).toMatchObject({ kind: 'system' })
    expect(runner.state.lines.at(-1)?.text).toMatch(/Sound|sound/)
  })

  it('notifies subscribers and caps the console', async () => {
    const { runner, workers } = setup()
    await bootReady(runner, workers)
    const seen = vi.fn()
    runner.subscribe(seen)
    for (let i = 0; i < 2100; i++) workers[0]?.emit({ type: 'out', stream: 'stdout', text: String(i) })
    expect(seen).toHaveBeenCalled()
    expect(runner.state.lines).toHaveLength(2000)
    expect(runner.state.lines.at(-1)?.text).toBe('2099')
  })
})

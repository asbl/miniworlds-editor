import type { ActorInfo, ClassInfo, Inspection, MethodInfo, ParamInfo, Snapshot, Status } from './scenario'

/** In-memory stand-in for ScenarioClient/ScenarioHost, for tests only (not imported by the app). */
export function fakeWorld(initial: Array<[string, number, number]> = [], classes: ClassInfo[] = []) {
  let next = 1
  const state = { frame: 0, paused: true, speed: 1, log: [] as string[] }
  const actors: ActorInfo[] = []
  const add = (cls: string, x: number, y: number) => {
    const a: ActorInfo = { handle: `h${next++}`, cls, x, y, direction: 0, size: [20, 20] }
    actors.push(a)
    return a
  }
  initial.forEach(([c, x, y]) => add(c, x, y))
  const find = (h: string) => {
    const a = actors.find((a) => a.handle === h)
    if (!a) throw new Error('Das Objekt existiert nicht mehr.')
    return a
  }
  const params: Record<string, ParamInfo[]> = {}
  const client = {
    act: async (n = 1) => void ((state.frame += n), state.log.push(`act ${n}`)),
    run: async () => void (state.paused = false),
    pause: async () => void (state.paused = true),
    setSpeed: async (f: number) => (state.speed = f),
    status: async (): Promise<Status> => ({
      frame: state.frame,
      paused: state.paused,
      fps: 60,
      speed: state.speed,
      actors: actors.length,
      by_class: actors.reduce<Record<string, number>>((m, a) => ((m[a.cls] = (m[a.cls] ?? 0) + 1), m), {}),
    }),
    snapshot: async (): Promise<Snapshot> => ({
      world: { cls: 'W', frame: state.frame, paused: state.paused, fps: 60, speed: state.speed },
      actors: actors.map((a) => ({ ...a })),
    }),
    classes: async () => classes,
    constructorParams: async (cls: string) => params[cls] ?? [],
    place: async (cls: string, x: number, y: number, texts: string[] = []) => {
      state.log.push(`place ${cls} ${texts.join('|')}`)
      return add(cls, x, y).handle
    },
    pick: async (x: number, y: number) => actors.findLast((a) => Math.abs(a.x - x) <= 10 && Math.abs(a.y - y) <= 10)?.handle ?? null,
    move: async (h: string, x: number, y: number) => void Object.assign(find(h), { x, y }),
    remove: async (h: string) => void actors.splice(actors.indexOf(find(h)), 1),
    inspect: async (h: string): Promise<Inspection> => ({ cls: find(h).cls, fields: { zaehler: '3' }, engine: { center: '(1, 2)' } }),
    methods: async (): Promise<MethodInfo[]> => [{ name: 'fressen', origin: 'Krabbe', params: [{ name: 'menge', keyword_only: false, required: false, default: '1' }] }],
    call: async (h: string, method: string, texts: string[]) => {
      const actor = find(h)
      state.log.push(`call ${h}.${method}(${texts.join(',')})`)
      if (method === 'turn_right') actor.direction += Number(texts[0])
      return { result: null }
    },
    exportCode: async () => actors.map((a) => `    ${a.cls.toLowerCase()} = ${a.cls}((${a.x}, ${a.y}))`).join('\n'),
  }
  return { client, actors, state, add, params }
}

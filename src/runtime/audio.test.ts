import { describe, expect, it } from 'vitest'
import { WebAudioEngine, type AudioContextLike, type GainLike, type SourceLike } from './audio'

function fakeContext() {
  const log = { starts: [] as { loop: boolean; offset: number | undefined }[], stops: 0, gains: [] as GainLike[], resumed: 0 }
  const ctx: AudioContextLike = {
    currentTime: 0,
    destination: {},
    state: 'suspended',
    resume: async () => void log.resumed++,
    createGain: () => {
      const g: GainLike = { gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} }
      log.gains.push(g)
      return g
    },
    createBufferSource: () => {
      const s: SourceLike = {
        buffer: null,
        loop: false,
        onended: null,
        connect() {},
        start: (_when, offset) => void log.starts.push({ loop: s.loop, offset }),
        stop: () => void log.stops++,
        disconnect() {},
      }
      return s
    },
    decodeAudioData: async () => ({ duration: 2 }),
  }
  return { ctx, log }
}

const tick = () => new Promise((r) => setTimeout(r, 0))
const bytes = () => new ArrayBuffer(8)

describe('WebAudioEngine', () => {
  it('plays a loaded sound once and music in a loop', async () => {
    const { ctx, log } = fakeContext()
    const engine = new WebAudioEngine(() => ctx)
    engine.handle({ op: 'load', key: 'k', data: bytes() })
    engine.handle({ op: 'play', key: 'k', id: 1, loops: 0, volume: 1 })
    engine.handle({ op: 'music-play', key: 'k', loops: -1, volume: 0.5, start: 0 })
    await tick()
    expect(log.starts.map((s) => s.loop)).toEqual([false, true])
    expect(log.resumed).toBeGreaterThan(0) // browsers start the context suspended
  })

  it('ignores a sound it never received', async () => {
    const { ctx, log } = fakeContext()
    const engine = new WebAudioEngine(() => ctx)
    engine.handle({ op: 'play', key: 'unknown', id: 1, loops: 0, volume: 1 })
    await tick()
    expect(log.starts).toEqual([])
  })

  it('stops everything when the program ends, also what is still being decoded', async () => {
    const { ctx, log } = fakeContext()
    const engine = new WebAudioEngine(() => ctx)
    engine.handle({ op: 'load', key: 'k', data: bytes() })
    engine.handle({ op: 'play', key: 'k', id: 1, loops: -1, volume: 1 })
    await tick()
    engine.handle({ op: 'play', key: 'k', id: 2, loops: 0, volume: 1 })
    engine.stopAll()
    await tick()
    expect(log.starts).toHaveLength(1) // the second one never started
    expect(log.stops).toBeGreaterThan(0)
  })

  it('mutes the master output and keeps the choice for later contexts', () => {
    const { ctx, log } = fakeContext()
    const engine = new WebAudioEngine(() => ctx)
    engine.setMuted(true)
    engine.handle({ op: 'load', key: 'k', data: bytes() })
    expect(log.gains[0]?.gain.value).toBe(0)
    engine.setMuted(false)
    expect(log.gains[0]?.gain.value).toBe(1)
    expect(engine.isMuted).toBe(false)
  })

  it('pauses and continues a sound where it was', async () => {
    const { ctx, log } = fakeContext()
    const engine = new WebAudioEngine(() => ctx)
    engine.handle({ op: 'load', key: 'k', data: bytes() })
    engine.handle({ op: 'play', key: 'k', id: 7, loops: -1, volume: 1 })
    await tick()
    ctx.currentTime = 0.5
    engine.handle({ op: 'pause', id: 7 })
    ctx.currentTime = 3
    engine.handle({ op: 'unpause', id: 7 })
    expect(log.starts.at(-1)?.offset).toBeCloseTo(0.5)
  })

  it('forgets decoded sounds on reset (the next worker sends its own)', async () => {
    const { ctx, log } = fakeContext()
    const engine = new WebAudioEngine(() => ctx)
    engine.handle({ op: 'load', key: 'k', data: bytes() })
    engine.reset()
    engine.handle({ op: 'play', key: 'k', id: 1, loops: 0, volume: 1 })
    await tick()
    expect(log.starts).toEqual([])
  })
})

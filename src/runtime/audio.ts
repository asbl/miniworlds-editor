/**
 * Sound for programs: the worker has no AudioContext, so pygame.mixer is replaced there (runner.py) by calls that arrive here as
 * `audio` messages, and the page plays them with Web Audio. Files are sent once (`load`), then played by key.
 */
export type AudioMessage =
  | { op: 'load'; key: string; data: ArrayBuffer }
  | { op: 'play'; key: string; id: number; loops: number; volume: number; fadeMs?: number }
  | { op: 'stop'; id: number }
  | { op: 'pause'; id: number }
  | { op: 'unpause'; id: number }
  | { op: 'volume'; id: number; volume: number }
  | { op: 'stop-all' }
  | { op: 'music-play'; key: string; loops: number; volume: number; start: number; fadeMs?: number }
  | { op: 'music-stop' }
  | { op: 'music-pause' }
  | { op: 'music-unpause' }
  | { op: 'music-volume'; volume: number }

/** What the runner needs from the page's audio. */
export interface AudioSink {
  handle(message: AudioMessage): void
  /** The program ended: nothing may go on playing. */
  stopAll(): void
  /** The worker is gone: its sounds are never asked for again, so the decoded copies can go. */
  reset?(): void
  readonly isMuted?: boolean
  setMuted?(muted: boolean): void
}

/** The part of Web Audio that is used (a fake stands in for it in unit tests). */
export interface AudioContextLike {
  currentTime: number
  destination: unknown
  state: string
  resume(): Promise<void>
  createGain(): GainLike
  createBufferSource(): SourceLike
  decodeAudioData(data: ArrayBuffer): Promise<BufferLike>
}
export interface GainLike {
  gain: { value: number; setValueAtTime(v: number, t: number): void; linearRampToValueAtTime(v: number, t: number): void }
  connect(node: unknown): void
  disconnect(): void
}
export interface BufferLike {
  duration: number
}
export interface SourceLike {
  buffer: BufferLike | null
  loop: boolean
  onended: (() => void) | null
  connect(node: unknown): void
  start(when?: number, offset?: number): void
  stop(when?: number): void
  disconnect(): void
}

class Voice {
  private source: SourceLike | null = null
  private startedAt = 0
  private offset = 0
  paused = false
  readonly gain: GainLike

  constructor(
    private ctx: AudioContextLike,
    out: unknown,
    private buffer: BufferLike,
    private loops: number,
    volume: number,
    private onEnd: () => void,
  ) {
    this.gain = ctx.createGain()
    this.gain.gain.value = volume
    this.gain.connect(out)
  }

  start(offset = 0, fadeMs = 0): void {
    const { ctx, buffer } = this
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.loop = this.loops !== 0
    source.connect(this.gain)
    this.source = source
    this.startedAt = ctx.currentTime
    this.offset = offset
    if (fadeMs > 0) {
      const target = this.gain.gain.value
      this.gain.gain.setValueAtTime(0, ctx.currentTime)
      this.gain.gain.linearRampToValueAtTime(target, ctx.currentTime + fadeMs / 1000)
    }
    source.start(0, offset)
    if (this.loops > 0 && buffer.duration > 0) source.stop(ctx.currentTime + Math.max(0, buffer.duration * (this.loops + 1) - offset))
    source.onended = () => {
      if (this.source === source) this.end()
    }
  }

  private end(): void {
    this.source = null
    this.gain.disconnect()
    this.onEnd()
  }

  stop(): void {
    const source = this.source
    this.source = null
    source?.stop()
    this.gain.disconnect()
    this.onEnd()
  }

  pause(): void {
    if (!this.source || this.paused) return
    const played = this.ctx.currentTime - this.startedAt
    const length = this.buffer.duration || 1
    this.offset = (this.offset + played) % length
    this.paused = true
    const source = this.source
    this.source = null
    source.onended = null
    source.stop()
  }

  unpause(): void {
    if (!this.paused) return
    this.paused = false
    this.start(this.offset)
  }

  setVolume(volume: number): void {
    this.gain.gain.value = Math.max(0, Math.min(1, volume))
  }
}

/** Web Audio playback of the program's sounds and music. Created lazily: browsers want a user action before sound. */
export class WebAudioEngine implements AudioSink {
  private ctx: AudioContextLike | null = null
  private master: GainLike | null = null
  private buffers = new Map<string, Promise<BufferLike>>()
  private voices = new Map<number, Voice>()
  private music: Voice | null = null
  private musicVolume = 1
  private muted = false
  /** Bumped by stopAll: a sound that was still being decoded then stays silent. */
  private round = 0

  constructor(private create: () => AudioContextLike = () => new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)() as unknown as AudioContextLike) {}

  get isMuted(): boolean {
    return this.muted
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    if (this.master) this.master.gain.value = muted ? 0 : 1
  }

  private context(): { ctx: AudioContextLike; master: GainLike } {
    if (!this.ctx || !this.master) {
      this.ctx = this.create()
      this.master = this.ctx.createGain()
      this.master.gain.value = this.muted ? 0 : 1
      this.master.connect(this.ctx.destination)
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {})
    return { ctx: this.ctx, master: this.master }
  }

  private buffer(key: string): Promise<BufferLike> | undefined {
    return this.buffers.get(key)
  }

  handle(message: AudioMessage): void {
    const { ctx, master } = this.context()
    switch (message.op) {
      case 'load':
        // a file that cannot be decoded is skipped quietly: the program goes on without that sound
        this.buffers.set(message.key, ctx.decodeAudioData(message.data.slice(0)))
        this.buffers.get(message.key)?.catch(() => {})
        break
      case 'play': {
        const decoded = this.buffer(message.key)
        if (!decoded) return
        const round = this.round
        void decoded.then((buffer) => {
          if (round !== this.round) return
          const voice = new Voice(ctx, master, buffer, message.loops, message.volume, () => {
            if (this.voices.get(message.id) === voice) this.voices.delete(message.id)
          })
          this.voices.set(message.id, voice)
          voice.start(0, message.fadeMs ?? 0)
        }, () => {})
        break
      }
      case 'stop':
        this.voices.get(message.id)?.stop()
        break
      case 'pause':
        this.voices.get(message.id)?.pause()
        break
      case 'unpause':
        this.voices.get(message.id)?.unpause()
        break
      case 'volume':
        this.voices.get(message.id)?.setVolume(message.volume)
        break
      case 'stop-all':
        this.stopAll()
        break
      case 'music-play': {
        const decoded = this.buffer(message.key)
        if (!decoded) return
        this.music?.stop()
        this.musicVolume = message.volume
        const round = this.round
        void decoded.then((buffer) => {
          if (round !== this.round) return
          this.music?.stop()
          const voice = new Voice(ctx, master, buffer, message.loops, message.volume, () => {
            if (this.music === voice) this.music = null
          })
          this.music = voice
          voice.start(message.start, message.fadeMs ?? 0)
        }, () => {})
        break
      }
      case 'music-stop':
        this.music?.stop()
        break
      case 'music-pause':
        this.music?.pause()
        break
      case 'music-unpause':
        this.music?.unpause()
        break
      case 'music-volume':
        this.musicVolume = message.volume
        this.music?.setVolume(message.volume)
        break
    }
  }

  reset(): void {
    this.stopAll()
    this.buffers.clear()
  }

  stopAll(): void {
    this.round++
    for (const voice of [...this.voices.values()]) voice.stop()
    this.voices.clear()
    this.music?.stop()
    this.music = null
  }
}

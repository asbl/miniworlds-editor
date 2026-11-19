import { isTextPath } from '../project/search'
import type { Runner } from '../runtime/runner'
import type { Fs } from '../workspace'
import type { Session } from '../ui/session'

export interface LiveResult {
  /** Something changed that only a restart applies (a statement, a start value, a new method). */
  reload: boolean
  /** Functions that now run the new numbers. */
  patched: number
  reasons: string[]
}

const THROTTLE_MS = 90

/**
 * Brings the running program up to the text in the editor, without restarting it: numbers inside methods, comments and
 * blank lines apply at once (see runtime/livepatch.py). Everything else is reported as `reload`.
 */
export class LiveSync {
  private timer: ReturnType<typeof setTimeout> | null = null
  private busy = false
  private again = false

  constructor(
    private runner: Runner,
    private fs: Fs,
    private session: () => Session | null,
  ) {}

  private get running(): boolean {
    return this.runner.state.phase === 'running'
  }

  /** The texts of all Python files as the pupil sees them (unsaved edits included). */
  private async sources(): Promise<Record<string, string> | null> {
    const session = this.session()
    if (!session) return null
    const out: Record<string, string> = {}
    for (const entry of await this.fs.list()) {
      if (entry.kind === 'file' && entry.path.endsWith('.py') && isTextPath(entry.path)) out[entry.path] = await session.readText(entry.path)
    }
    return out
  }

  /** Apply now. Null when nothing runs or the engine could not answer (then the caller restarts as before). */
  async sync(): Promise<LiveResult | null> {
    if (!this.running) return null
    const files = await this.sources()
    if (!files) return null
    const reply = await this.runner.rpc<LiveResult>('live', files)
    return reply.ok ? reply.value : null
  }

  /** Apply soon, at most about ten times a second (a slider sends one change per pixel). */
  request(): void {
    if (!this.running) return
    if (this.busy) {
      this.again = true
      return
    }
    if (this.timer) return
    this.timer = setTimeout(async () => {
      this.timer = null
      this.busy = true
      try {
        await this.sync()
      } finally {
        this.busy = false
        if (this.again) {
          this.again = false
          this.request()
        }
      }
    }, THROTTLE_MS)
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}

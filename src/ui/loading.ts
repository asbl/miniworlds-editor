import type { LanguageState } from '../language/service'
import type { RunnerState } from '../runtime/runner'

export type PartStatus = 'waiting' | 'loading' | 'ready' | 'failed'

export interface LoadingView {
  /** `loading`: something still comes up; `done`: everything is there; `failed`: Python could not be loaded. */
  status: 'loading' | 'done' | 'failed'
  /** Python + miniworlds (needed to start a program). */
  world: PartStatus
  /** Completion, hints and problems in the editor. A failure here never blocks anything. */
  help: PartStatus
}

/**
 * What is still loading, for the big start-up banner.
 * `bootSeen`: the runner has been booting at some point, so `idle` without a version means the boot failed (and not "not started yet").
 */
export function loadingView(runner: Pick<RunnerState, 'phase' | 'version'>, language: Pick<LanguageState, 'phase'>, bootSeen: boolean): LoadingView {
  const world: PartStatus =
    runner.version !== null ? 'ready' : runner.phase === 'booting' ? 'loading' : runner.phase === 'idle' && bootSeen ? 'failed' : 'waiting'
  // `dormant` is the low-memory sleep of the help: nothing to wait for
  const help: PartStatus = language.phase === 'ready' || language.phase === 'dormant' ? 'ready' : language.phase === 'error' ? 'failed' : 'loading'
  const status = world === 'failed' ? 'failed' : world !== 'ready' || help === 'loading' ? 'loading' : 'done'
  return { status, world, help }
}

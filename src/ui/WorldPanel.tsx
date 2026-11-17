import { useEffect, useRef } from 'preact/hooks'
import { t, useLang } from '../i18n'
import { attachInput } from '../runtime/input'
import type { Runner } from '../runtime/runner'
import type { TraceLocation } from '../runtime/traceback'
import { Console } from './Console'
import { useRunnerState } from './hooks'

/** Right-hand panel: the world's canvas (lives in the worker) and the console. */
export function WorldPanel({ runner, onJump }: { runner: Runner; onJump: (location: TraceLocation) => void }) {
  useLang()
  const state = useRunnerState(runner)
  const stage = useRef<HTMLDivElement>(null)

  // The canvas element is replaced with every new worker (it can be handed over only once): mount the current one.
  useEffect(() => {
    const canvas = runner.canvas
    canvas.setAttribute('aria-label', t('run.canvasLabel'))
    stage.current?.replaceChildren(canvas)
    const detach = attachInput(canvas, (event) => runner.sendInput(event))
    return detach
  }, [runner, state.canvasGeneration])

  const bootText = state.phase === 'booting' ? t(`run.boot.${state.bootStep ?? 'pyodide'}` as const) : null

  return (
    <aside class="world-panel">
      <div class="world-stage" ref={stage} />
      <div class="world-status" role="status">
        {bootText ?? t(`run.state.${state.phase === 'booting' ? 'idle' : state.phase}` as const)}
        {state.version && <span class="muted"> · miniworlds {state.version}</span>}
      </div>
      <Console lines={state.lines} onClear={() => runner.clearConsole()} onJump={onJump} />
    </aside>
  )
}

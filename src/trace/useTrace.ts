import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Runner } from '../runtime/runner'
import { isFrameMethod, TraceStore, type TraceRow } from './traceStore'

/** How long a method counts as "just called" (the pulse in the list, the glow in the editor and diagram). */
export const GLOW_MS = 450
const REDRAW_MS = 200

export interface TraceView {
  store: TraceStore
  /** Bumps whenever the panel should redraw. */
  version: number
  /** Classes with an event method called a moment ago. */
  fired: ReadonlySet<string>
  clear: () => void
}

/**
 * Collects the runner's trace batches. Redraws at most five times a second; while something is glowing, one more redraw
 * follows when the glow is over. `onFire` gets every event method (not `act`) the moment it is called, for the editor.
 */
export function useTrace(runner: Runner, onFire: (row: TraceRow) => void): TraceView {
  const store = useMemo(() => new TraceStore(), [])
  const [version, setVersion] = useState(0)
  const fire = useRef(onFire)
  fire.current = onFire

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let decay: ReturnType<typeof setTimeout> | null = null
    let pending = false
    const redraw = () => {
      timer = null
      pending = false
      setVersion((n) => n + 1)
    }
    const off = runner.subscribeTrace((batch) => {
      const now = performance.now()
      for (const row of store.add(batch, now)) if (!isFrameMethod(row.method)) fire.current(row)
      if (!pending) {
        pending = true
        timer = setTimeout(redraw, REDRAW_MS)
      }
      // one more pass when the last glow has faded
      if (decay) clearTimeout(decay)
      decay = setTimeout(() => setVersion((n) => n + 1), GLOW_MS + REDRAW_MS)
    })
    // a new program starts: start counting again
    let was = runner.state.phase
    const offState = runner.subscribe(() => {
      const phase = runner.state.phase
      if (phase === 'running' && was !== 'running') {
        store.clear()
        setVersion((n) => n + 1)
      }
      was = phase
    })
    return () => {
      off()
      offState()
      if (timer) clearTimeout(timer)
      if (decay) clearTimeout(decay)
    }
  }, [runner, store])

  const fired = useMemo(() => store.firedClasses(performance.now(), GLOW_MS), [store, version])
  return { store, version, fired, clear: () => (store.clear(), setVersion((n) => n + 1)) }
}

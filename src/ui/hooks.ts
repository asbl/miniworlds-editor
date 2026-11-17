import { useEffect, useState } from 'preact/hooks'
import type { Runner, RunnerState } from '../runtime/runner'
import type { Catalog } from '../packages/catalog'

/** Re-render when the runner's state changes. */
export function useRunnerState(runner: Runner): RunnerState {
  const [state, setState] = useState(runner.state)
  useEffect(() => {
    setState(runner.state)
    return runner.subscribe(() => setState(runner.state))
  }, [runner])
  return state
}

/** Re-render when the version catalog changes; returns a snapshot counter-free view. */
export function useCatalog(catalog: Catalog): { data: Catalog['data']; status: Catalog['status'] } {
  const [, bump] = useState(0)
  useEffect(() => catalog.subscribe(() => bump((n) => n + 1)), [catalog])
  return { data: catalog.data, status: catalog.status }
}

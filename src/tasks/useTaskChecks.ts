import { useCallback, useEffect, useRef } from 'preact/hooks'
import type { MiniworldsController } from '../miniworlds/controller'
import type { MiniworldsMeta } from '../miniworlds/meta'
import type { ConsoleLine } from '../runtime/runner'
import type { ClassModel } from '../uml/model'
import { evaluate, needsMoves, needsOutput, type Facts } from './checks'

interface Args {
  meta: MiniworldsMeta
  setMeta: (meta: MiniworldsMeta) => void
  controller: MiniworldsController
  facts: Facts
  lines: readonly ConsoleLine[]
  model: ClassModel | null
  files: Record<string, string>
}

/**
 * Ticks a task by itself as soon as its check is met. A tick is never taken back automatically; a pupil who un-ticks a
 * task by hand is not ticked again for it in this session.
 */
export function useTaskChecks({ meta, setMeta, controller, facts, lines, model, files }: Args) {
  const checks = meta.checks ?? []
  const pending = checks.some((c, i) => c && !meta.tasksDone[i])
  const manualOff = useRef(new Set<number>())

  useEffect(() => {
    controller.setTrackMoves(checks.some((c, i) => c && !meta.tasksDone[i] && needsMoves(c)))
  }, [controller, meta.checks, meta.tasksDone]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pending) return
    const wantsOutput = checks.some((c, i) => c && !meta.tasksDone[i] && needsOutput(c))
    const output = wantsOutput ? lines.map((l) => l.text).join('\n') : ''
    const done: Record<string, boolean> = {}
    checks.forEach((check, i) => {
      if (check && !meta.tasksDone[i] && !manualOff.current.has(i) && evaluate(check, { facts, output, model, files })) done[i] = true
    })
    if (Object.keys(done).length > 0) setMeta({ ...meta, tasksDone: { ...meta.tasksDone, ...done } })
  }, [pending, facts, model, files, lines, meta.checks, meta.tasksDone]) // eslint-disable-line react-hooks/exhaustive-deps

  /** The pupil's own tick or un-tick. */
  const toggle = useCallback(
    (i: number) => {
      if (meta.tasksDone[i]) manualOff.current.add(i)
      else manualOff.current.delete(i)
      setMeta({ ...meta, tasksDone: { ...meta.tasksDone, [i]: !meta.tasksDone[i] } })
    },
    [meta, setMeta],
  )

  return { toggle, hasCheck: (i: number) => !!checks[i] }
}

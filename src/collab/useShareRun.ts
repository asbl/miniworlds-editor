import { useEffect } from 'preact/hooks'
import type { Runner } from '../runtime/runner'
import type { Collab } from './collab'
import { MAX_SHARED_OUTPUT } from './shared'
import { useCollabInfo } from './useCollabInfo'

const BATCH_MS = 250

/**
 * What this person's program prints goes to the others too (the people in the room read it in their console, next to their
 * own): batched, and not more than `MAX_SHARED_OUTPUT` characters per run, so that a program that never stops printing does
 * not flood the room. Messages of the editor itself ("system") stay private.
 */
export function useShareRun(collab: Collab | null, runner: Runner): void {
  useEffect(() => {
    if (!collab || collab.readOnly) return
    let lastId = runner.state.lines.at(-1)?.id ?? -1
    let phase = runner.state.phase
    let buffer: { kind: string; text: string }[] = []
    let sent = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    const flush = () => {
      timer = null
      if (buffer.length === 0) return
      const lines = buffer
      buffer = []
      collab.shareLines(lines)
    }
    const off = runner.subscribe(() => {
      const state = runner.state
      if (state.phase === 'running' && phase !== 'running') {
        flush()
        sent = 0
        collab.shareRunStart()
      }
      for (const line of state.lines) {
        if (line.id <= lastId) continue
        lastId = line.id
        if (line.kind === 'system') continue
        if (sent > MAX_SHARED_OUTPUT) continue
        sent += line.text.length
        buffer.push({ kind: line.kind, text: sent > MAX_SHARED_OUTPUT ? '…' : line.text })
      }
      if (buffer.length > 0 && timer === null) timer = setTimeout(flush, BATCH_MS)
      if (phase === 'running' && state.phase !== 'running') {
        flush()
        collab.shareRunEnd()
      }
      phase = state.phase
    })
    return () => {
      off()
      if (timer !== null) clearTimeout(timer)
    }
  }, [collab, runner])
}

export interface RemoteConsole {
  id: number
  name: string
  color: string
  running: boolean
  started: number
  unseen: number
  lines: { id: number; kind: 'stdout' | 'stderr' | 'input' | 'hint'; text: string }[]
}

/** The others' output (people who ran a program in this room), for the console. */
export function useRemoteConsoles(collab: Collab | null): { runs: RemoteConsole[]; preferred: number | null } {
  const info = useCollabInfo(collab)
  if (!collab || !info) return { runs: [], preferred: null }
  const runs: RemoteConsole[] = []
  for (const person of info.people) {
    const run = collab.remoteRuns.get(person.id)
    if (run && !person.self) runs.push({ id: person.id, name: person.name, color: person.color, running: run.running, started: run.started, unseen: run.unseen, lines: [...run.lines] })
  }
  // the console shows by itself the output of the person one follows, or who drives
  return { runs, preferred: info.following ?? (info.driver !== collab.id ? info.driver : null) }
}

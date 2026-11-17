import { useEffect, useRef, useState } from 'preact/hooks'
import { isTextPath } from '../project/search'
import type { Runner } from '../runtime/runner'
import type { Fs } from '../workspace'
import type { Session } from './session'

export interface SyntaxProblem {
  path: string
  line: number
  message: string
}

const DELAY_MS = 900

/**
 * Greenfoot view: after a pause in typing, check the code and reload the world (the start setup is replayed).
 * A syntax error leaves the running world alone and is reported instead.
 */
export function useAutoReload(opts: { enabled: boolean; session: Session | null; runner: Runner; fs: Fs; reload: () => void }) {
  const { enabled, session, runner, fs } = opts
  const [problem, setProblem] = useState<SyntaxProblem | null>(null)
  const reload = useRef(opts.reload)
  reload.current = opts.reload

  useEffect(() => {
    if (!enabled || !session) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = session.subscribeEdits(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(async () => {
        if (runner.state.mode !== 'scenario' || runner.state.phase !== 'running') return
        await session.saveAll()
        const sources: Record<string, string> = {}
        for (const e of await fs.list()) if (e.kind === 'file' && e.path.endsWith('.py') && isTextPath(e.path)) sources[e.path] = await fs.read(e.path)
        const reply = await runner.rpc<SyntaxProblem | null>('check', sources)
        if (!reply.ok) return
        setProblem(reply.value)
        if (reply.value === null) reload.current()
      }, DELAY_MS)
    })
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
  }, [enabled, session, runner, fs])

  return { problem, clearProblem: () => setProblem(null) }
}

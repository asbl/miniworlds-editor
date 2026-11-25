import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Session } from '../ui/session'
import type { Fs, Workspace } from '../workspace'
import { compare, History, type Snapshot, type SnapshotReason } from './history'
import { readTexts } from './restore'

/** An automatic snapshot while working: not more often than this, and only if something changed (working together: more often, since somebody else's mistake lands here at once). */
const TIMER_MS = 3 * 60 * 1000
const CHECK_MS = 30 * 1000

/** Snapshots of the project: when opened, before every run, now and then while editing, before deleting, and on request. */
export function useHistory(workspace: Workspace, fs: Fs, session: Session | null, timerMs = TIMER_MS) {
  const history = useMemo(() => (workspace.history ? new History(workspace.history) : null), [workspace])
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const changed = useRef(false)
  const lastAuto = useRef(Date.now())

  const reload = useCallback(async () => {
    if (history) setSnapshots(await history.list())
  }, [history])

  /** Never throws: remembering is a safety net and must not get in the way of what the user is doing. */
  const record = useCallback(
    async (reason: SnapshotReason, label?: string): Promise<Snapshot | null> => {
      if (!history || !session) return null
      try {
        const made = await history.record(await readTexts(fs, session), reason, label)
        if (made) {
          changed.current = false
          lastAuto.current = Date.now()
          await reload()
        }
        return made
      } catch (error) {
        console.warn('History: snapshot failed', error)
        return null
      }
    },
    [history, session, fs, reload],
  )

  // the state at the start of the session, and the list for the panel
  useEffect(() => {
    void reload()
    if (session) void record('open')
  }, [reload, record, session])

  // now and then while editing
  useEffect(() => {
    if (!session) return
    const off = session.subscribeEdits(() => (changed.current = true))
    const timer = setInterval(() => {
      if (changed.current && Date.now() - lastAuto.current >= timerMs) void record('timer')
    }, CHECK_MS)
    return () => {
      off()
      clearInterval(timer)
    }
  }, [session, record, timerMs])

  /** The program just ran without an error: remember the state that ran as one that worked. Never throws. */
  const lastMarked = useRef(0)
  const markWorked = useCallback(async (texts: Record<string, string>) => {
    if (!history) return
    try {
      // a new snapshot at most once a minute; a state that has one already is only marked
      const made = await history.markWorked(texts, Date.now() - lastMarked.current > 60_000)
      if (made) lastMarked.current = Date.now()
      await reload()
    } catch (error) {
      console.warn('History: marking failed', error)
    }
  }, [history, reload])

  /** The newest state that worked, if it differs from what is in the editor now. */
  const workedBefore = useCallback(async (): Promise<Snapshot | null> => {
    if (!history || !session) return null
    try {
      const snapshot = await history.lastWorked()
      if (!snapshot) return null
      const now = await readTexts(fs, session)
      const old = await history.read(snapshot.id)
      return Object.entries(compare(old, now)).some(([, status]) => status !== 'same') ? snapshot : null
    } catch {
      return null
    }
  }, [history, session, fs])

  return { history, snapshots, record, reload, markWorked, workedBefore }
}

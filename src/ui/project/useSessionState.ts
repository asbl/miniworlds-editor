import { useEffect, useState } from 'preact/hooks'
import type { Session, SessionState } from '../session'

/** The open tabs, the active file and the unsaved files of a session, as React-style state. */
export function useSessionState(session: Session | null): SessionState {
  const [state, setState] = useState<SessionState>(session?.state ?? { open: [], active: null, dirty: new Set() })
  useEffect(() => {
    if (!session) return
    setState(session.state)
    return session.subscribe(() => setState(session.state))
  }, [session])
  return state
}

import { useEffect, useState } from 'preact/hooks'
import type { Collab } from './collab'
import type { CollabStatus } from './provider'
import type { Person } from './shared'

export interface CollabInfo {
  status: CollabStatus
  synced: boolean
  people: Person[]
  readOnly: boolean
  /** The person who drives (pair programming), if any. */
  driver: number | null
  /** This person cannot type now. */
  locked: boolean
  following: number | null
}

/** The state of a session as plain data; re-renders when the connection, the people or the roles change. */
export function useCollabInfo(collab: Collab | null): CollabInfo | null {
  const [, bump] = useState(0)
  useEffect(() => collab?.subscribe(() => bump((n) => n + 1)), [collab])
  return collab
    ? { status: collab.status, synced: collab.provider.synced, people: collab.people(), readOnly: collab.readOnly, driver: collab.driver, locked: collab.locked, following: collab.following }
    : null
}

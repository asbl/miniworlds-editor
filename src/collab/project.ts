import type { ProjectStore } from '../workspace'
import { deserializeInvite, serializeInvite, type Invite } from './shared'
import { savedRoom } from './storage'

/** Reuse the room's local files and history, independently of UI language or display titles. */
export async function roomProject(store: ProjectStore, invite: Invite): Promise<string> {
  const projects = await store.list()
  const matches = (name: string) => {
    const saved = deserializeInvite(savedRoom(name))
    return saved !== null && serializeInvite(saved) === serializeInvite(invite)
  }
  const remembered = projects.find(matches)
  if (remembered) return remembered

  // Old versions used translated dialog titles as project names. A project
  // that has left its room has no saved invitation, but still has its history.
  const base = `Multiplayer ${invite.room}`
  for (const name of [`Gemeinsam arbeiten ${invite.room}`, `Work together ${invite.room}`, base]) {
    if (projects.includes(name) && savedRoom(name) === null) return name
  }

  // A same-named project may belong to a different invitation or access mode.
  let name = base
  for (let n = 2; projects.includes(name); n++) name = `${base} (${n})`
  return name
}

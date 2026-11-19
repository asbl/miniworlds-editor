import events from './events.json'

/** The events a class can react to, as a pupil asks for them ("when the space key is pressed") and the method that answers. */

export type EventGroup = 'key' | 'mouse' | 'sense' | 'time'
export type ClassTarget = 'actor' | 'world'
export type Param = 'key' | 'class' | 'message'

export interface EventDef {
  id: string
  group: EventGroup
  applies: ClassTarget[]
  /** Something the pupil chooses first: a key, another class, a message text. */
  param?: Param
  /** The method; `{key}`, `{class}`, `{cls}` (lower case), `{message}` are filled in. CodeMirror snippet fields stay. */
  code: string
  /** The method's name, with the same placeholders: used to find out whether it exists already. */
  method: string
}

export const GROUPS: EventGroup[] = ['key', 'mouse', 'sense', 'time']

export const EVENTS = events as EventDef[]

export const eventsFor = (target: ClassTarget): EventDef[] => EVENTS.filter((e) => e.applies.includes(target))

/** Keys the engine knows (tools/keys.py), in the spelling of the event name. */
export const KEY_CHOICES = ['left', 'right', 'up', 'down', 'space', 'return', 'esc', 'tab', ...'abcdefghijklmnopqrstuvwxyz'.split('')]

export interface Choice {
  key?: string
  /** The class name as written (`Wand`). */
  className?: string
  message?: string
}

const fill = (template: string, choice: Choice): string =>
  template
    .replaceAll('{key}', choice.key ?? '')
    .replaceAll('{class}', choice.className ?? '')
    .replaceAll('{cls}', (choice.className ?? '').toLowerCase())
    .replaceAll('{message}', (choice.message ?? '').replaceAll('\\', '\\\\').replaceAll('"', '\\"'))

export interface Built {
  /** Name of the method that will be added. */
  method: string
  /** Snippet for the editor. */
  code: string
}

export function build(event: EventDef, choice: Choice): Built {
  return { method: fill(event.method, choice), code: fill(event.code, choice) }
}

/** Is the choice complete (a key picked, a class picked, a message typed)? */
export function complete(event: EventDef, choice: Choice): boolean {
  if (event.param === 'key') return !!choice.key && KEY_CHOICES.includes(choice.key)
  if (event.param === 'class') return !!choice.className && /^[A-Za-z_][A-Za-z0-9_]*$/.test(choice.className)
  if (event.param === 'message') return !!choice.message?.trim()
  return true
}

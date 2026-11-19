import { t, type MessageKey } from '../i18n'
import { infoDialog, openDialog } from '../ui/dialogs'
import { build, complete, eventsFor, GROUPS, KEY_CHOICES, type Built, type ClassTarget, type EventDef } from './events'

const KEY_LABELS: Record<string, string> = { left: '← left', right: '→ right', up: '↑ up', down: '↓ down', space: 'space', return: 'Enter (return)', esc: 'Esc', tab: 'Tab' }

/** The method's name as a hint under the choice: `on_key_down_…`. */
const hintOf = (event: EventDef) => event.method.replace('{key}', '…').replace('{cls}', '…')

/**
 * "React to …": which event, then (if it needs one) which key, class or message. Resolves with the method to add, or
 * null when the pupil cancelled.
 */
export async function askEvent(target: ClassTarget, className: string, actorClasses: string[]): Promise<Built | null> {
  const events = GROUPS.flatMap((group) => eventsFor(target).filter((e) => e.group === group))
  const first = await openDialog({
    title: t('event.title', { name: className }),
    message: t('event.intro'),
    submit: 'event.next',
    fields: [
      {
        kind: 'radio',
        key: 'event',
        label: t('event.which'),
        initial: events[0]?.id ?? '',
        options: events.map((e) => ({ value: e.id, label: `${t(`eventgroup.${e.group}` as MessageKey)}: ${t(`event.${e.id}` as MessageKey)}`, hint: hintOf(e) })),
      },
    ],
  })
  if (!first) return null
  const event = events.find((e) => e.id === first.event)
  if (!event) return null
  if (!event.param) return build(event, {})

  if (event.param === 'class' && actorClasses.length === 0) {
    await infoDialog(t('event.title', { name: className }), t('event.noClasses'))
    return null
  }
  const field =
    event.param === 'key'
      ? ({ kind: 'select', key: 'value', label: t('event.key'), initial: 'space', options: KEY_CHOICES.map((k) => ({ value: k, label: KEY_LABELS[k] ?? k })) } as const)
      : event.param === 'class'
        ? ({ kind: 'select', key: 'value', label: t('event.class'), initial: actorClasses[0] ?? '', options: actorClasses.map((c) => ({ value: c, label: c })) } as const)
        : ({ kind: 'text', key: 'value', label: t('event.messageText'), initial: '', placeholder: 'Start' } as const)
  const second = await openDialog({
    title: t(`event.${event.id}` as MessageKey),
    submit: 'event.add',
    fields: [field],
    validate: (v) => {
      const value = String(v.value ?? '')
      const choice = event.param === 'key' ? { key: value } : event.param === 'class' ? { className: value } : { message: value }
      return complete(event, choice) ? null : t('event.incomplete')
    },
  })
  if (!second) return null
  const value = String(second.value)
  return build(event, event.param === 'key' ? { key: value } : event.param === 'class' ? { className: value } : { message: value })
}

import { useLang, t } from '../i18n'
import type { InputEvent } from '../runtime/protocol'
import { toPygameKey } from '../runtime/keymap'

type Pad = { key: string; label: string; aria: 'left' | 'right' | 'up' | 'down' | 'action' }
const KEYS: Pad[] = [
  { key: 'ArrowLeft', label: '◀', aria: 'left' },
  { key: 'ArrowUp', label: '▲', aria: 'up' },
  { key: 'ArrowDown', label: '▼', aria: 'down' },
  { key: 'ArrowRight', label: '▶', aria: 'right' },
]

/** Arrow keys and an action key on the screen, for tablets and phones without a keyboard. Sends the same events as the keyboard. */
export function TouchPad({ send }: { send: (event: InputEvent) => void }) {
  useLang()
  const press = (key: string, down: boolean) => {
    const code = toPygameKey({ key, code: key })
    if (code !== null) send({ kind: down ? 'keydown' : 'keyup', key: code, mod: 0, unicode: key === ' ' ? ' ' : '' })
  }
  const button = ({ key, label, aria }: Pad) => (
    <button
      type="button"
      key={key}
      class={`pad pad-${aria}`}
      aria-label={t(`pad.${aria}` as 'pad.left')}
      onPointerDown={(e) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture?.(e.pointerId)
        press(key, true)
      }}
      onPointerUp={() => press(key, false)}
      onPointerCancel={() => press(key, false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {label}
    </button>
  )
  return (
    <div class="touchpad" role="group" aria-label={t('pad.title')}>
      <div class="pad-arrows">{KEYS.map(button)}</div>
      <div class="pad-action">{button({ key: ' ', label: 'A', aria: 'action' })}</div>
    </div>
  )
}

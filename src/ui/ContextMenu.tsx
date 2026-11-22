import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import { t, useLang } from '../i18n'

export type ContextItem = { header: string } | '-' | { text: string; run: () => void; danger?: boolean }

interface Open {
  x: number
  y: number
  items: ContextItem[]
  trigger: HTMLElement | null
}

let setOpenMenu: ((open: Open | null) => void) | null = null

/** Opens the context menu at viewport coordinates. */
export function openContextMenu(x: number, y: number, items: ContextItem[]): void {
  setOpenMenu?.({ x, y, items, trigger: document.activeElement instanceof HTMLElement ? document.activeElement : null })
}

/** Rendered once by the app; keeps itself inside the viewport and closes on outside click, scroll and Escape. */
export function ContextMenuHost() {
  useLang()
  const [open, setOpen] = useState<Open | null>(null)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  const root = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    setOpenMenu = setOpen
    return () => {
      setOpenMenu = null
    }
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    const close = () => { setOpen(null); if (open.trigger?.isConnected) open.trigger.focus() }
    const away = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) close()
    }
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return }
      if (e.key === 'Tab') { close(); return }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
      const buttons = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])
      if (!buttons.length) return
      e.preventDefault()
      const current = buttons.findIndex((button) => button === document.activeElement)
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (current + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
      buttons[next]?.focus()
    }
    document.addEventListener('pointerdown', away, true)
    document.addEventListener('keydown', keys)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', away, true)
      document.removeEventListener('keydown', keys)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open || !root.current) return
    const { offsetWidth: w, offsetHeight: h } = root.current
    setPos({ left: Math.max(4, Math.min(open.x, innerWidth - w - 8)), top: Math.max(4, Math.min(open.y, innerHeight - h - 8)) })
    root.current.querySelector('button')?.focus()
  }, [open])

  if (!open) return null
  const heading = open.items.find((item): item is { header: string } => typeof item === 'object' && 'header' in item)
  return (
    <section aria-label={heading?.header ?? t('context.actions')}>
    <div class="context-menu" role="menu" aria-label={heading?.header} ref={root} style={{ left: `${pos.left}px`, top: `${pos.top}px` }}>
      {open.items.map((item, i) =>
        item === '-' ? (
          <div class="sep" key={i} role="separator" />
        ) : 'header' in item ? (
          <div class="header" aria-hidden="true" key={i}>
            {item.header}
          </div>
        ) : (
          <button
            type="button"
            role="menuitem"
            class={item.danger ? 'danger' : ''}
            key={i}
            onClick={() => {
              setOpen(null)
              if (open.trigger?.isConnected) open.trigger.focus()
              item.run()
            }}
          >
            {item.text}
          </button>
        ),
      )}
    </div>
    </section>
  )
}

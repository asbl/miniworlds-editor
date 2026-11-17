import { useEffect, useRef, useState } from 'preact/hooks'

export type ContextItem = { header: string } | '-' | { text: string; run: () => void; danger?: boolean }

interface Open {
  x: number
  y: number
  items: ContextItem[]
}

let setOpenMenu: ((open: Open | null) => void) | null = null

/** Opens the context menu at viewport coordinates. */
export function openContextMenu(x: number, y: number, items: ContextItem[]): void {
  setOpenMenu?.({ x, y, items })
}

/** Rendered once by the app; keeps itself inside the viewport and closes on outside click, scroll and Escape. */
export function ContextMenuHost() {
  const [open, setOpen] = useState<Open | null>(null)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setOpenMenu = setOpen
    return () => {
      setOpenMenu = null
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(null)
    const away = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) close()
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('pointerdown', away, true)
    document.addEventListener('keydown', esc)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', away, true)
      document.removeEventListener('keydown', esc)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [open])

  useEffect(() => {
    if (!open || !root.current) return
    const { offsetWidth: w, offsetHeight: h } = root.current
    setPos({ left: Math.max(4, Math.min(open.x, innerWidth - w - 8)), top: Math.max(4, Math.min(open.y, innerHeight - h - 8)) })
    root.current.querySelector('button')?.focus()
  }, [open])

  if (!open) return null
  return (
    <div class="context-menu" role="menu" ref={root} style={{ left: `${pos.left}px`, top: `${pos.top}px` }}>
      {open.items.map((item, i) =>
        item === '-' ? (
          <div class="sep" key={i} role="separator" />
        ) : 'header' in item ? (
          <div class="header" key={i}>
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
              item.run()
            }}
          >
            {item.text}
          </button>
        ),
      )}
    </div>
  )
}

import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'

export interface MenuItem {
  label: string
  onSelect: () => void
  /** Visually separated group start. */
  divider?: boolean
  highlighted?: boolean
  disabled?: boolean
  checked?: boolean
  /** With `checked`: an on/off switch (menuitemcheckbox) instead of one of several choices (menuitemradio). */
  toggle?: boolean
  /** A caption between groups (not selectable). */
  heading?: boolean
  /** Tooltip. */
  title?: string
  /** Separate help action, usable without hovering or selecting the item. */
  help?: { label: string; onSelect: () => void | Promise<void> }
}

/** Small dropdown menu; closes on outside click, Escape and selection. */
export function Menu({ label, items, title, align = 'left' }: { label: ComponentChildren; items: MenuItem[]; title?: string; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  return (
    <div class="menu" ref={root}>
      <button type="button" class="menu-button" aria-haspopup="menu" aria-expanded={open} title={title} onClick={() => setOpen(!open)}>
        {label}
      </button>
      {open && (
        <div class={`menu-items ${align}${items.some((item) => item.help) ? ' with-help' : ''}`} role="menu">
          {items.map((item) =>
            item.heading ? (
              <div class="menu-heading" role="presentation" key={item.label}>
                {item.label}
              </div>
            ) : (
              <div class={item.help ? 'menu-item-with-help' : undefined} role="none" key={item.label}>
                <button
                  type="button"
                  role={item.checked === undefined ? 'menuitem' : item.toggle ? 'menuitemcheckbox' : 'menuitemradio'}
                  aria-checked={item.checked}
                  class={[item.divider && 'divider', item.highlighted && 'highlighted'].filter(Boolean).join(' ')}
                  disabled={item.disabled}
                  title={item.title}
                  onClick={() => {
                    setOpen(false)
                    item.onSelect()
                  }}
                >
                  <span class="check">{item.checked ? '✓' : ''}</span>
                  {item.label}
                </button>
                {item.help && (
                  <button
                    type="button"
                    role="menuitem"
                    class="menu-help"
                    aria-label={item.help.label}
                    title={item.help.label}
                    onClick={async () => {
                      setOpen(false)
                      try {
                        await item.help?.onSelect()
                      } finally {
                        root.current?.querySelector<HTMLButtonElement>('.menu-button')?.focus()
                      }
                    }}
                  >
                    <span aria-hidden="true">?</span>
                  </button>
                )}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  )
}

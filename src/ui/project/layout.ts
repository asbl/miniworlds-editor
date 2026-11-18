/** Which of the three columns is shown on a narrow screen. */
export type Pane = 'files' | 'editor' | 'world'

/** The widths a person chose for the side columns; null = the stylesheet's default (and its narrow-screen rules). */
export interface PanelWidths {
  sidebar: number | null
  world: number | null
}

export type Panel = keyof PanelWidths

/** Keep in step with the defaults in style.css. */
export const PANEL_LIMITS: Record<Panel, { min: number; max: number; fallback: number }> = {
  sidebar: { min: 160, max: 560, fallback: 250 },
  world: { min: 260, max: 900, fallback: 440 },
}

/** The code column never gets narrower than this because of a wide side column. */
export const MIN_EDITOR_WIDTH = 320

/** A side column's width within its own limits and what the other columns leave over. */
export function clampWidth(panel: Panel, width: number, bodyWidth: number, otherWidth: number): number {
  const { min, max } = PANEL_LIMITS[panel]
  const room = bodyWidth - otherWidth - MIN_EDITOR_WIDTH
  return Math.round(Math.max(min, Math.min(max, room, width)))
}

/**
 * The widths to apply in a container of this width: the chosen widths, reduced where a smaller window cannot hold them
 * (the choice itself stays as it was, so a big window gets it back). The sidebar goes first, the world takes what is left.
 */
export function effectiveWidths(widths: PanelWidths, bodyWidth: number): PanelWidths {
  if (bodyWidth <= 0) return widths
  const sidebar = widths.sidebar === null ? null : clampWidth('sidebar', widths.sidebar, bodyWidth, widths.world ?? PANEL_LIMITS.world.fallback)
  const world = widths.world === null ? null : clampWidth('world', widths.world, bodyWidth, sidebar ?? PANEL_LIMITS.sidebar.fallback)
  return { sidebar, world }
}

export const LAYOUT_KEY = 'miniworlds-editor.layout'
export const NO_WIDTHS: PanelWidths = { sidebar: null, world: null }

const width = (value: unknown, panel: Panel): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const { min, max } = PANEL_LIMITS[panel]
  return Math.round(Math.max(min, Math.min(max, value)))
}

export function parseWidths(text: string | null): PanelWidths {
  try {
    const raw = text ? (JSON.parse(text) as Partial<Record<Panel, unknown>> | null) : null
    return { sidebar: width(raw?.sidebar, 'sidebar'), world: width(raw?.world, 'world') }
  } catch {
    return NO_WIDTHS
  }
}

export function loadWidths(): PanelWidths {
  try {
    return parseWidths(localStorage.getItem(LAYOUT_KEY))
  } catch {
    return NO_WIDTHS
  }
}

export function saveWidths(widths: PanelWidths): void {
  try {
    if (widths.sidebar === null && widths.world === null) localStorage.removeItem(LAYOUT_KEY)
    else localStorage.setItem(LAYOUT_KEY, JSON.stringify(widths))
  } catch {
    /* kept for this session only */
  }
}

/** Inline style for the columns' container: only the widths that were chosen. */
export function widthStyle(widths: PanelWidths): string {
  return [widths.sidebar !== null ? `--sidebar-w:${widths.sidebar}px` : '', widths.world !== null ? `--world-w:${widths.world}px` : ''].filter(Boolean).join(';')
}

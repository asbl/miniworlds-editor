/** A small picture of coloured squares (no framework, no DOM): what the drawing tool edits. `null` is transparent. */
export type Cell = string | null

export const PALETTE = ['#000000', '#5c5c5c', '#a8a8a8', '#ffffff', '#e03b3b', '#f28c28', '#f6cf4a', '#79c36b', '#2f9a45', '#4aa3df', '#2f5fc4', '#7a4fc4', '#e58bbd', '#8a5a2b', '#f6c28b', '#1e293b']

export class PixelGrid {
  cells: Cell[]
  private history: Cell[][] = []

  constructor(
    readonly size: number,
    cells?: Cell[],
  ) {
    this.cells = cells ? [...cells] : new Array<Cell>(size * size).fill(null)
  }

  private index(x: number, y: number): number {
    return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < this.size && y < this.size ? y * this.size + x : -1
  }

  get(x: number, y: number): Cell {
    const i = this.index(x, y)
    return i < 0 ? null : (this.cells[i] as Cell)
  }

  /** Remember the state before a stroke starts, so that "undo" takes back the whole stroke. */
  mark(): void {
    this.history.push([...this.cells])
    if (this.history.length > 50) this.history.shift()
  }

  undo(): boolean {
    const before = this.history.pop()
    if (!before) return false
    this.cells = before
    return true
  }

  set(x: number, y: number, color: Cell): boolean {
    const i = this.index(x, y)
    if (i < 0 || this.cells[i] === color) return false
    this.cells[i] = color
    return true
  }

  /** A line of cells from one point to the next (no gaps when the pointer moves fast). */
  line(x0: number, y0: number, x1: number, y1: number, color: Cell): boolean {
    let changed = false
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1)
    for (let i = 0; i <= steps; i++) changed = this.set(Math.round(x0 + ((x1 - x0) * i) / steps), Math.round(y0 + ((y1 - y0) * i) / steps), color) || changed
    return changed
  }

  /** Paint bucket: every connected cell of the same colour (4 neighbours). */
  fill(x: number, y: number, color: Cell): boolean {
    const start = this.index(x, y)
    if (start < 0) return false
    const target = this.cells[start] as Cell
    if (target === color) return false
    const stack = [start]
    while (stack.length > 0) {
      const i = stack.pop() as number
      if (this.cells[i] !== target) continue
      this.cells[i] = color
      const cx = i % this.size
      const cy = Math.floor(i / this.size)
      if (cx > 0) stack.push(i - 1)
      if (cx < this.size - 1) stack.push(i + 1)
      if (cy > 0) stack.push(i - this.size)
      if (cy < this.size - 1) stack.push(i + this.size)
    }
    return true
  }

  clear(): void {
    this.cells.fill(null)
  }

  isBlank(): boolean {
    return this.cells.every((c) => c === null)
  }
}

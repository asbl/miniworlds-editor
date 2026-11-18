import { EMPTY_FACTS, type Facts } from './checks'
import type { ActorInfo } from '../miniworlds/scenario'

const MOVED_PIXELS = 2

/**
 * Collects what happened in the running world, for the task checks: the most actors of each class, which classes moved,
 * what was selected or called. `facts` is a new object after every change (so a view can compare by identity).
 */
export class FactTracker {
  facts: Facts = EMPTY_FACTS
  private start = new Map<string, [number, number]>()

  reset(): boolean {
    const changed = this.facts !== EMPTY_FACTS
    this.facts = EMPTY_FACTS
    this.start.clear()
    return changed
  }

  /** Counts per class and the step number (the cheap poll). Returns whether something changed. */
  status(byClass: Record<string, number>, frame: number): boolean {
    const maxByClass = { ...this.facts.maxByClass }
    for (const [cls, n] of Object.entries(byClass)) if (n > (maxByClass[cls] ?? 0)) maxByClass[cls] = n
    const same = sameCounts(this.facts.byClass, byClass) && sameCounts(this.facts.maxByClass, maxByClass) && frame <= this.facts.maxFrame
    if (same) return false
    this.facts = { ...this.facts, byClass: { ...byClass }, maxByClass, maxFrame: Math.max(this.facts.maxFrame, frame) }
    return true
  }

  /**
   * Positions of all actors (needs a snapshot). Before the first step, positions are the starting positions (also after the
   * pupil dragged things around); later an actor that is more than a couple of pixels away from its start has moved.
   */
  actors(actors: readonly ActorInfo[], frame: number): boolean {
    const moved = new Set(this.facts.moved)
    for (const a of actors) {
      const first = this.start.get(a.handle)
      if (frame === 0 || !first) this.start.set(a.handle, [a.x, a.y])
      else if (Math.hypot(a.x - first[0], a.y - first[1]) > MOVED_PIXELS) moved.add(a.cls)
    }
    if (moved.size === this.facts.moved.length) return false
    this.facts = { ...this.facts, moved: [...moved] }
    return true
  }

  selected(cls: string): boolean {
    if (this.facts.selected.includes(cls)) return false
    this.facts = { ...this.facts, selected: [...this.facts.selected, cls] }
    return true
  }

  called(method: string): boolean {
    if (this.facts.called.includes(method)) return false
    this.facts = { ...this.facts, called: [...this.facts.called, method] }
    return true
  }
}

function sameCounts(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false
  return true
}

import type { ModelClass } from '../uml/model'
import { setClassImage } from './classImage'

const IMAGE_EXT = '(?:png|jpe?g|gif|bmp|webp)'
const FIRST = new RegExp(`^(\\s*)self\\.add_costume\\(\\s*(["'])([^"']*\\.${IMAGE_EXT})\\2\\s*\\)\\s*$`, 'i')
const SIZE = /^\s*self\.size\s*=/
const ADD_IMAGES = /^\s*self\.costume\.add_images\(\s*\[(.*)\]\s*\)\s*$/
const ANIMATE = /^\s*self\.(animate|animate_loop)\(\s*(?:speed\s*=\s*)?(\d+)?\s*\)\s*$/

type ClassSpan = Pick<ModelClass, 'line' | 'end_line' | 'methods'>

export interface Costumes {
  /** Image paths in order; the first is the costume, the others its animation frames. */
  frames: string[]
  /** Steps of the world between two frames (the engine's `speed`); null: no animation. */
  speed: number | null
  loop: boolean
}

export const EMPTY: Costumes = { frames: [], speed: null, loop: true }

const quoted = (text: string): string[] => [...text.matchAll(new RegExp(`(["'])([^"']*\\.${IMAGE_EXT})\\1`, 'gi'))].map((m) => m[2] as string)

/** What a class's source says about its pictures: `add_costume`, `costume.add_images([...])`, `animate(_loop)(speed=n)`. */
export function readCostumes(classSource: string): Costumes {
  const out: Costumes = { frames: [], speed: null, loop: true }
  for (const line of classSource.split('\n')) {
    const first = FIRST.exec(line)
    if (first && out.frames.length === 0) {
      out.frames.push(first[3] as string)
      continue
    }
    const more = ADD_IMAGES.exec(line)
    if (more) {
      out.frames.push(...quoted(more[1] as string))
      continue
    }
    const anim = ANIMATE.exec(line)
    if (anim) {
      out.loop = anim[1] === 'animate_loop'
      out.speed = anim[2] ? Number(anim[2]) : 10
    }
  }
  return out
}

/** Frames per second (what a pupil thinks in) ⇄ the engine's steps between frames (60 steps a second). */
export const speedToFps = (speed: number) => Math.max(1, Math.round(60 / Math.max(1, speed)))
export const fpsToSpeed = (fps: number) => Math.max(1, Math.round(60 / Math.max(1, fps)))

export type CostumeEdit = { ok: true; text: string } | { ok: false; reason: 'one-line-setup' | 'no-frames' }

/**
 * Writes the pictures into the class: `self.add_costume(first)` (and its size) as for a single picture, then
 * `self.costume.add_images([...])` for the other frames and `self.animate_loop(speed=n)` or `self.animate(speed=n)`.
 * Lines of an earlier version of the same block are replaced.
 */
export function setClassCostumes(source: string, cls: ClassSpan, costumes: Costumes, size: [number, number] | null): CostumeEdit {
  const [first, ...rest] = costumes.frames
  if (!first) return { ok: false, reason: 'no-frames' }
  const edit = setClassImage(source, cls, first, size, 'costume')
  if (!edit.ok) return edit
  const lines = edit.text.split('\n')
  const at = lines.findIndex((l, i) => i >= cls.line - 1 && FIRST.test(l) && (FIRST.exec(l)?.[3] ?? '') === first)
  if (at === -1) return edit
  const indent = (FIRST.exec(lines[at] as string)?.[1] ?? '        ') as string
  let end = at + 1
  if (SIZE.test(lines[end] ?? '')) end++
  // drop what an earlier version of this block wrote right below
  while (end < lines.length && (ADD_IMAGES.test(lines[end] as string) || ANIMATE.test(lines[end] as string))) lines.splice(end, 1)
  const extra: string[] = []
  if (rest.length > 0) extra.push(`${indent}self.costume.add_images([${rest.map((p) => `"${p}"`).join(', ')}])`)
  if (costumes.speed !== null && costumes.frames.length > 1) extra.push(`${indent}self.${costumes.loop ? 'animate_loop' : 'animate'}(speed=${costumes.speed})`)
  lines.splice(end, 0, ...extra)
  return { ok: true, text: lines.join('\n') }
}

import type { ModelClass } from '../uml/model'

const IMAGE_EXT = '(?:png|jpe?g|gif|bmp|webp)'
const IMAGE_IN_CODE = new RegExp(`["']([\\w\\-./ ]+\\.${IMAGE_EXT})["']`, 'i')
const COSTUME_LINE = new RegExp(`^(\\s*)self\\.add_costume\\(\\s*(["'])[^"']*\\.${IMAGE_EXT}\\2\\s*\\)\\s*$`, 'i')
/** A world's background line: an image or a colour, anything inside the brackets. */
const BACKGROUND_LINE = /^(\s*)self\.(?:add_background|add_bg|set_background|set_bg)\(.*\)\s*$/

/** The first quoted image path in a class's source (the caller checks that the file exists). */
export function classImagePath(classSource: string): string | null {
  return IMAGE_IN_CODE.exec(classSource)?.[1] ?? null
}

/** Display size: at most 80 px on the longer side, never enlarged. */
export function fitSize(width: number, height: number): [number, number] {
  const scale = Math.min(1, 80 / Math.max(width, height))
  return [Math.round(width * scale), Math.round(height * scale)]
}

export type ImageEdit = { ok: true; text: string } | { ok: false; reason: 'one-line-setup' }

type ClassSpan = Pick<ModelClass, 'line' | 'end_line' | 'methods'>

/**
 * Sets a class's picture in the source: `self.add_costume("path")` plus `self.size = (w, h)` in `on_setup`.
 * An existing add_costume line is replaced, a missing `on_setup` is created. A one-line `def on_setup(self): …` is
 * not changed automatically (the caller tells the user).
 */
export function setClassImage(source: string, cls: ClassSpan, path: string, size: [number, number] | null, mode: 'costume' | 'background' = 'costume'): ImageEdit {
  const lines = source.split('\n')
  const background = mode === 'background'
  const costume = (indent: string) => `${indent}self.${background ? 'add_background' : 'add_costume'}("${path}")`
  const sizeLine = (indent: string) => (size && !background ? [`${indent}self.size = (${size[0]}, ${size[1]})`] : [])
  const existing = background ? BACKGROUND_LINE : COSTUME_LINE

  for (let i = cls.line - 1; i < cls.end_line && i < lines.length; i++) {
    const found = existing.exec(lines[i] as string)
    if (!found) continue
    const indent = found[1] as string
    const hasSize = !background && /^\s*self\.size\s*=/.test(lines[i + 1] ?? '')
    if (hasSize && size) lines.splice(i, 2, costume(indent), ...sizeLine(indent)) // replace costume and its size
    else if (!hasSize) lines.splice(i, 1, costume(indent), ...sizeLine(indent)) // add a size if we know one
    else lines.splice(i, 1, costume(indent)) // keep the existing size line
    return { ok: true, text: lines.join('\n') }
  }

  const setup = cls.methods.find((m) => m.name === 'on_setup')
  if (setup) {
    const defLine = lines[setup.line - 1] as string
    const afterSignature = defLine.replace(/^\s*def\s+\w+\([^)]*\)\s*(->\s*[^:]+)?/, '')
    if (/:\s*[^\s#]/.test(afterSignature)) return { ok: false, reason: 'one-line-setup' }
    const indent = /^\s*/.exec(defLine)![0] + '    '
    lines.splice(setup.line, 0, costume(indent), ...sizeLine(indent))
    return { ok: true, text: lines.join('\n') }
  }

  lines.splice(cls.end_line, 0, '', '    def on_setup(self):', costume('        '), ...sizeLine('        '))
  return { ok: true, text: lines.join('\n') }
}

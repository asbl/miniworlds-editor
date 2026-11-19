import { describe, expect, it } from 'vitest'
import { fpsToSpeed, readCostumes, setClassCostumes, speedToFps } from './classCostumes'

const span = (source: string, start: number, end: number, setupLine?: number) => ({ line: start, end_line: end, methods: setupLine ? [{ name: 'on_setup', line: setupLine, visibility: '+' as const }] : [] })

const CLASS = `import miniworlds as mw


class Wurm(mw.Actor):
    def on_setup(self):
        self.add_costume("images/a.png")
        self.size = (40, 40)
        self.move(1)
`

describe('readCostumes', () => {
  it('reads a single picture', () => {
    expect(readCostumes(CLASS)).toEqual({ frames: ['images/a.png'], speed: null, loop: true })
  })
  it('reads frames and the animation', () => {
    const text = CLASS.replace('self.move(1)', 'self.costume.add_images(["images/b.png", \'images/c.png\'])\n        self.animate_loop(speed=8)')
    expect(readCostumes(text)).toEqual({ frames: ['images/a.png', 'images/b.png', 'images/c.png'], speed: 8, loop: true })
  })
  it('knows a one-time animation', () => {
    expect(readCostumes('self.add_costume("a.png")\nself.animate(speed=5)')).toEqual({ frames: ['a.png'], speed: 5, loop: false })
  })
  it('takes the default speed when none is written', () => {
    expect(readCostumes('self.animate_loop()').speed).toBe(10)
  })
})

describe('setClassCostumes', () => {
  it('adds frames and a loop below the costume and its size', () => {
    const r = setClassCostumes(CLASS, span(CLASS, 4, 8, 5), { frames: ['images/a.png', 'images/b.png', 'images/c.png'], speed: 8, loop: true }, [40, 40])
    expect(r.ok && r.text).toContain('        self.size = (40, 40)\n        self.costume.add_images(["images/b.png", "images/c.png"])\n        self.animate_loop(speed=8)\n        self.move(1)')
  })

  it('replaces an earlier block instead of stacking', () => {
    const first = setClassCostumes(CLASS, span(CLASS, 4, 8, 5), { frames: ['images/a.png', 'images/b.png'], speed: 8, loop: true }, [40, 40])
    expect(first.ok).toBe(true)
    const text = (first as { text: string }).text
    const again = setClassCostumes(text, span(text, 4, 10, 5), { frames: ['images/a.png', 'images/c.png'], speed: 4, loop: false }, [40, 40])
    expect(again.ok && again.text).toContain('self.costume.add_images(["images/c.png"])\n        self.animate(speed=4)')
    expect(again.ok && again.text.match(/add_images/g)?.length).toBe(1)
    expect(again.ok && again.text.match(/animate/g)?.length).toBe(1)
  })

  it('turns an animation back into a single picture', () => {
    const first = setClassCostumes(CLASS, span(CLASS, 4, 8, 5), { frames: ['images/a.png', 'images/b.png'], speed: 8, loop: true }, [40, 40]) as { ok: true; text: string }
    const single = setClassCostumes(first.text, span(first.text, 4, 10, 5), { frames: ['images/a.png'], speed: null, loop: true }, [40, 40])
    expect(single.ok && single.text).toBe(CLASS)
  })

  it('creates on_setup when the class has none', () => {
    const source = 'class Tier(mw.Actor):\n    pass\n'
    const r = setClassCostumes(source, span(source, 1, 2), { frames: ['a.png', 'b.png'], speed: 6, loop: true }, null)
    expect(r.ok && r.text).toContain('    def on_setup(self):\n        self.add_costume("a.png")\n        self.costume.add_images(["b.png"])\n        self.animate_loop(speed=6)')
  })

  it('refuses an empty list', () => {
    expect(setClassCostumes(CLASS, span(CLASS, 4, 8, 5), { frames: [], speed: null, loop: true }, null)).toEqual({ ok: false, reason: 'no-frames' })
  })

  it('does not animate a single frame', () => {
    const r = setClassCostumes(CLASS, span(CLASS, 4, 8, 5), { frames: ['images/a.png'], speed: 8, loop: true }, [40, 40])
    expect(r.ok && r.text).not.toContain('animate')
  })
})

describe('speed', () => {
  it('converts between frames per second and steps', () => {
    expect(fpsToSpeed(10)).toBe(6)
    expect(speedToFps(6)).toBe(10)
    expect(fpsToSpeed(60)).toBe(1)
    expect(speedToFps(0)).toBe(60)
  })
})

import { describe, expect, it } from 'vitest'
import type { ClassModel } from '../uml/model'
import { EMPTY_FACTS, evaluate, parseCheck } from './checks'
import { suggestIdeas } from './suggest'
import { tipsFor } from './tips'

const cls = (name: string, methods: string[] = []) => ({ name, file: `classes/${name}.py`, line: 1, end_line: 3, bases: ['Actor'], kind: 'actor' as const, methods: methods.map((m) => ({ name: m, line: 2, visibility: '+' as const })), attributes: [] })
const model = (...classes: ReturnType<typeof cls>[]): ClassModel => ({ classes, libraries: [], errors: [] })
const files = { 'classes/Fisch.py': 'class Fisch:\n    pass\n' }

describe('suggestIdeas', () => {
  it('suggests nothing for a program without figures', () => {
    expect(suggestIdeas(model(), {}, 'de')).toEqual([])
    expect(suggestIdeas(null, {}, 'de')).toEqual([])
  })

  it('offers at most four ideas, each with an automatic check', () => {
    const ideas = suggestIdeas(model(cls('Fisch'), cls('Hai')), files, 'de')
    expect(ideas).toHaveLength(4)
    expect(ideas[0]?.text).toContain('Fisch')
    expect(ideas.every((i) => parseCheck(i.check) !== null)).toBe(true)
  })

  it('leaves out what the program already does', () => {
    const m = model(cls('Fisch', ['on_key_pressed_left', 'on_detecting_actor']), cls('Hai'))
    const src = { 'classes/Fisch.py': 'self.add_costume("a.png")\nmw.Text((1,1),"x")\nself.remove()\nimport random', 'classes/Hai.py': 'class Hai: pass' }
    const texts = suggestIdeas(m, src, 'de').map((i) => i.text)
    expect(texts.some((x) => x.includes('Tastatur'))).toBe(false)
    expect(texts.some((x) => x.includes('Punktestand'))).toBe(false)
    expect(texts.some((x) => x.includes('Zufall'))).toBe(false)
  })

  it('ticks an idea once the code does it', () => {
    const m = model(cls('Fisch'))
    const idea = suggestIdeas(m, files, 'en').find((i) => i.check.type === 'source' && i.check.contains === 'Text(')
    expect(idea).toBeDefined()
    const env = { facts: EMPTY_FACTS, output: '', model: m, files }
    expect(evaluate(idea!.check, env)).toBe(false)
    expect(evaluate(idea!.check, { ...env, files: { ...files, 'main.py': 'x = mw.Text((1, 1), "hi")' } })).toBe(true)
  })
})

describe('tipsFor', () => {
  const env = { facts: EMPTY_FACTS, output: '', model: model(cls('Fisch')), files }

  it('gives two graded tips for an open check', () => {
    const tips = tipsFor({ type: 'handler', prefix: 'on_key', tip: 'key' }, env, 'de')
    expect(tips).toHaveLength(2)
    expect(tips[1]).toContain('def on_key_pressed_left')
  })

  it('takes the first open part of an "all" check', () => {
    const tips = tipsFor({ type: 'all', of: [{ type: 'class', name: 'Fisch' }, { type: 'class', name: 'Hai' }] }, env, 'en')
    expect(tips.join(' ')).toContain('Hai')
  })

  it('gives nothing for a check that is met', () => {
    expect(tipsFor({ type: 'class', name: 'Fisch' }, env, 'de')).toEqual([])
  })
})

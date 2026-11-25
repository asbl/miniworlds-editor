import { t, type Lang, type MessageKey } from '../i18n'
import type { ClassModel } from '../uml/model'
import { classImagePath } from '../project/classImage'
import { classSource } from '../uml/model'
import { evaluate, EMPTY_FACTS, type Check } from './checks'

export interface Idea {
  text: string
  check: Check
}

const MAX_IDEAS = 4

/**
 * Next steps for a program that came without tasks (a pupil's own, imported, or a fresh one): small things miniworlds is good
 * at that the code does not use yet. Each comes with an automatic check, so it ticks itself when the pupil has done it.
 * Ideas the program already satisfies are left out.
 */
export function suggestIdeas(model: ClassModel | null, files: Record<string, string>, lang?: Lang): Idea[] {
  const actors = model?.classes.filter((c) => c.kind === 'actor') ?? []
  const first = actors[0]
  if (!model || !first) return []
  const say = (key: MessageKey, params: Record<string, string | number> = {}) => t(key, params, lang)
  const source = (needle: string) => Object.entries(files).some(([path, text]) => path.endsWith('.py') && text.includes(needle))
  const candidates: (Idea | null)[] = [
    model.classes.some((c) => c.methods.some((m) => m.name.startsWith('on_key'))) ? null : { text: say('idea.key', { cls: first.name }), check: { type: 'handler', prefix: 'on_key', tip: 'key' } },
    (() => {
      const bare = actors.find((c) => classImagePath(classSource(c, files)) === null)
      return bare ? { text: say('idea.image', { cls: bare.name }), check: { type: 'image', cls: bare.name } as Check } : null
    })(),
    actors.length > 1 && !source('detect') && !model.classes.some((c) => c.methods.some((m) => m.name.startsWith('on_detecting')))
      ? { text: say('idea.touch', { a: first.name, b: (actors[1] ?? first).name }), check: { type: 'handler', prefix: 'on_detecting', tip: 'touch' } }
      : null,
    source('Text(') ? null : { text: say('idea.text'), check: { type: 'source', contains: 'Text(', tip: 'text' } },
    source('.remove(') ? null : { text: say('idea.remove'), check: { type: 'source', contains: '.remove(', tip: 'remove' } },
    source('random') ? null : { text: say('idea.random'), check: { type: 'source', contains: 'random', tip: 'random' } },
  ]
  const env = { facts: EMPTY_FACTS, output: '', model, files }
  return candidates.filter((c): c is Idea => c !== null && !evaluate(c.check, env)).slice(0, MAX_IDEAS)
}

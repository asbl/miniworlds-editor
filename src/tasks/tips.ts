import { t, type Lang, type MessageKey } from '../i18n'
import { evaluate, type Check, type CheckEnv } from './checks'

/** The part of a check that is still open (for `all`: the first part not met yet). */
export function openPart(check: Check, env: CheckEnv): Check | null {
  if (check.type !== 'all') return evaluate(check, env) ? null : check
  for (const part of check.of) {
    const open = openPart(part, env)
    if (open) return open
  }
  return null
}

/**
 * Graded help for a task with an automatic check: first where to look, then what to type. Built from the check, so every
 * task has it - from a template, a teacher, or the editor's own ideas for a program the pupil brought along.
 */
export function tipsFor(check: Check, env: CheckEnv, lang?: Lang): string[] {
  const open = openPart(check, env)
  if (!open) return []
  const say = (key: string, params: Record<string, string | number> = {}) => {
    const k = `tip.${key}` as MessageKey
    const text = t(k, params, lang)
    return text === k ? null : text
  }
  const keys = (type: string, params: Record<string, string | number>, sub = type) => [say(`${sub}.1`, params), say(`${sub}.2`, params)].filter((x): x is string => x !== null)
  switch (open.type) {
    case 'actors':
      return keys('actors', { cls: open.cls })
    case 'gone':
    case 'fewer':
      return keys('gone', { cls: open.cls })
    case 'moved':
      return keys('moved', { cls: open.cls })
    case 'selected':
    case 'called':
    case 'frames':
      return keys(open.type, { min: open.type === 'frames' ? open.min : 0, method: open.type === 'called' ? (open.method ?? '') : '' })
    case 'output':
      return keys('output', { text: open.contains })
    case 'class':
      return keys('class', { name: open.name })
    case 'method':
      return keys('method', { cls: open.cls, name: open.name })
    case 'image':
      return keys('image', { cls: open.cls })
    case 'changed':
      return keys('changed', { path: open.path })
    case 'handler':
      return keys('handler', { prefix: open.prefix }, `handler.${open.tip ?? 'other'}`)
    case 'source':
      return keys('source', { text: open.contains }, `source.${open.tip ?? 'other'}`)
    case 'all':
      return []
  }
}

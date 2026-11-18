import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

/**
 * Colours of the code in both schemes. CodeMirror's default palette is made for a light background and fails the contrast
 * rule (WCAG AA) on a dark one, so the colours are CSS variables that switch with the scheme (see style.css, --tok-*).
 */
const style = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword], color: 'var(--tok-keyword)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--tok-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--tok-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--tok-comment)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.variableName)], color: 'var(--tok-function)' },
  { tag: [t.className, t.typeName, t.namespace], color: 'var(--tok-class)' },
  { tag: [t.meta, t.annotation, t.self], color: 'var(--tok-meta)' },
  { tag: t.invalid, color: 'var(--danger)' },
])

export const codeHighlighting = syntaxHighlighting(style)

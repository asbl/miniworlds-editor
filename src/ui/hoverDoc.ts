import { t, type MessageKey } from '../i18n'

/** A jedi hover docstring, split for compact display in the tooltip. */
export interface HoverDoc {
  /** The `name(...)` line jedi prepends to function/class docs, when present. */
  signature: string | null
  /** The leading paragraphs, before any `Args:`/`Returns:`/... section. */
  summary: string
  /** The remaining sections, example blocks removed and capped in length. */
  details: string
}

const MAX_DETAILS = 480
const SECTION = /^(args|arguments|parameters|params|returns?|yields?|raises?|warns?|attributes?|notes?|examples?|see also)\s*:?\s*$/i
const EXAMPLE = /^examples?\s*:?\s*$/i
const SIGNATURE_LINE = /^[A-Za-z_][\w.]*\(.*\)/

/** Split a raw jedi docstring: signature line off the top, then dedented summary plus capped details. */
export function parseHoverDoc(doc: string): HoverDoc {
  const lines = doc.replace(/\r\n?/g, '\n').split('\n')
  let signature: string | null = null
  const first = lines[0] ?? ''
  if (lines.length && SIGNATURE_LINE.test(first.trim())) {
    signature = first.trim()
    lines.splice(0, 1)
  }
  // dedent like inspect.cleandoc, then drop blank edges
  const indents = lines.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length)
  const cut = indents.length ? Math.min(...indents) : 0
  const text = lines.map((l) => l.slice(cut)).join('\n').replace(/^\s+|\s+$/g, '')
  const firstLine = (p: string) => p.split('\n', 1)[0] ?? ''
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  const firstSection = paragraphs.findIndex((p) => SECTION.test(firstLine(p).trim()))
  const summary = (firstSection === -1 ? paragraphs : paragraphs.slice(0, firstSection)).join('\n\n')
  let details = ''
  if (firstSection !== -1) {
    // example blocks are long code samples: they do not belong into a tooltip (header and body, until the next section)
    const kept: string[] = []
    let skipping = false
    for (const p of paragraphs.slice(firstSection)) {
      if (SECTION.test(firstLine(p).trim())) skipping = EXAMPLE.test(firstLine(p).trim())
      if (!skipping) kept.push(p)
    }
    details = kept.join('\n\n')
    if (details.length > MAX_DETAILS) {
      const space = details.lastIndexOf(' ', MAX_DETAILS)
      details = details.slice(0, space > 0 ? space : MAX_DETAILS) + ' …'
    }
  }
  return { signature, summary, details }
}

const KIND: Record<string, MessageKey> = {
  function: 'assist.kind.function',
  class: 'assist.kind.class',
  module: 'assist.kind.module',
  instance: 'assist.kind.instance',
  statement: 'assist.kind.statement',
  param: 'assist.kind.param',
  keyword: 'assist.kind.keyword',
  property: 'assist.kind.property',
  path: 'assist.kind.path',
}

/** German/English label for a jedi type (`function`, `class`, ...), falling back to the raw type. */
export function kindLabel(type: string): string {
  const key = KIND[type]
  return key ? t(key) : type
}

/** The hover tooltip: name and kind on top, signature, then summary and (capped) details. */
export function renderHoverDoc(info: { name: string; type: string; doc: string }): HTMLElement {
  const { signature, summary, details } = parseHoverDoc(info.doc)
  const dom = document.createElement('div')
  dom.className = 'cm-hover-doc'
  const head = document.createElement('div')
  head.className = 'cm-hover-head'
  const name = document.createElement('span')
  name.className = 'cm-hover-name'
  name.textContent = info.name
  const kind = document.createElement('span')
  kind.className = 'cm-hover-kind'
  kind.textContent = kindLabel(info.type)
  head.append(name, kind)
  dom.append(head)
  if (signature) {
    const sig = document.createElement('pre')
    sig.className = 'cm-hover-sig'
    sig.textContent = signature
    dom.append(sig)
  }
  if (summary) {
    const p = document.createElement('div')
    p.className = 'cm-hover-summary'
    p.textContent = summary
    dom.append(p)
  }
  if (details) {
    const d = document.createElement('div')
    d.className = 'cm-hover-details'
    d.textContent = details
    dom.append(d)
  }
  return dom
}

import type { ClassKind, ClassModel, Member, ModelClass, ModelLibrary } from './model'

const HEAD_H = 30
const ROW_H = 17
const PAD = 6
const GAP_X = 18
const GAP_Y = 44
const MAX_ROWS = 6

export interface Node {
  name: string
  kind: ClassKind
  /** A miniworlds class (dashed box, not clickable into source). */
  lib: boolean
  info: ModelClass | ModelLibrary
  parent: string | null
  /** Further bases (multiple inheritance), drawn as secondary arrows. */
  extra: string[]
  children: Node[]
  attrs: Member[]
  methods: Member[]
  hiddenAttrs: number
  hiddenMethods: number
  x: number
  y: number
  w: number
  h: number
  span: number
  depth: number
}

export interface Edge {
  path: string
  arrow: string
  secondary: boolean
}

export interface Layout {
  nodes: Node[]
  edges: Edge[]
  width: number
  height: number
}

export const methodText = (m: Member) => `${m.visibility} ${m.name}(${(m.params ?? []).join(', ')})`
export const attrText = (a: Member) => `${a.visibility} ${a.name}`
export const STEREOTYPE: Record<ClassKind, string> = { world: '«Welt»', actor: '«Akteur»', other: '' }

function newNode(name: string, kind: ClassKind, lib: boolean, info: ModelClass | ModelLibrary): Node {
  return { name, kind, lib, info, parent: null, extra: [], children: [], attrs: [], methods: [], hiddenAttrs: 0, hiddenMethods: 0, x: 0, y: 0, w: 0, h: 0, span: 0, depth: 0 }
}

function measure(node: Node, details: boolean): void {
  let longest = node.name.length + (STEREOTYPE[node.kind] ? 2 : 0) + 8
  let height = HEAD_H
  if (!node.lib && details) {
    const info = node.info as ModelClass
    node.attrs = info.attributes.slice(0, MAX_ROWS)
    node.hiddenAttrs = Math.max(0, info.attributes.length - MAX_ROWS)
    node.methods = info.methods.slice(0, MAX_ROWS)
    node.hiddenMethods = Math.max(0, info.methods.length - MAX_ROWS)
    for (const a of node.attrs) longest = Math.max(longest, attrText(a).length)
    for (const m of node.methods) longest = Math.max(longest, methodText(m).length)
    const attrRows = node.attrs.length + (node.hiddenAttrs ? 1 : 0)
    const methodRows = node.methods.length + (node.hiddenMethods ? 1 : 0)
    height += (attrRows ? attrRows * ROW_H + PAD : PAD) + (methodRows ? methodRows * ROW_H + PAD : PAD)
  }
  node.w = Math.min(260, Math.max(details ? 132 : 104, Math.round(longest * 7.1) + 28))
  node.h = height
}

const RANK: Record<ClassKind, number> = { world: 0, actor: 1, other: 2 }

/** Inheritance forest: user classes plus the miniworlds classes they derive from. Cycles are cut, first duplicate name wins. */
export function buildGraph(model: ClassModel, details: boolean): { nodes: Map<string, Node>; roots: Node[] } {
  const nodes = new Map<string, Node>()
  for (const lib of model.libraries) nodes.set(lib.name, newNode(lib.name, lib.kind, true, lib))
  for (const info of model.classes) {
    const existing = nodes.get(info.name)
    if (existing && !existing.lib) continue
    nodes.set(info.name, newNode(info.name, info.kind, false, info))
  }
  for (const [name, node] of nodes) {
    const bases = node.lib ? ((node.info as ModelLibrary).base ? [(node.info as ModelLibrary).base as string] : []) : (node.info as ModelClass).bases
    for (const b of bases) {
      if (!nodes.has(b) || b === name) continue
      if (!node.parent) node.parent = b
      else node.extra.push(b)
    }
  }
  for (const [name] of nodes) {
    const seen = new Set<string>()
    let cur: string | null = name
    while (cur && nodes.get(cur)?.parent) {
      if (seen.has(cur)) {
        ;(nodes.get(name) as Node).parent = null
        break
      }
      seen.add(cur)
      cur = (nodes.get(cur) as Node).parent
    }
  }
  for (const node of nodes.values()) {
    measure(node, details)
    if (node.parent) (nodes.get(node.parent) as Node).children.push(node)
  }
  const roots = [...nodes.values()].filter((n) => !n.parent).sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.name.localeCompare(b.name))
  const sortChildren = (n: Node) => {
    n.children.sort((a, b) => a.name.localeCompare(b.name))
    n.children.forEach(sortChildren)
  }
  roots.forEach(sortChildren)
  return { nodes, roots }
}

/** Tree layout, roots on top. */
export function layoutModel(model: ClassModel, details = true): Layout {
  const { nodes, roots } = buildGraph(model, details)
  if (nodes.size === 0) return { nodes: [], edges: [], width: 0, height: 0 }

  const span = (n: Node): number => {
    const kids = n.children.reduce((s, c) => s + span(c), 0) + GAP_X * Math.max(0, n.children.length - 1)
    return (n.span = Math.max(n.w, kids))
  }
  roots.forEach(span)

  const rowH: number[] = []
  const depth = (n: Node, d: number) => {
    n.depth = d
    rowH[d] = Math.max(rowH[d] ?? 0, n.h)
    n.children.forEach((c) => depth(c, d + 1))
  }
  roots.forEach((r) => depth(r, 0))
  const rowY: number[] = []
  let y = 8
  rowH.forEach((h, i) => {
    rowY[i] = y
    y += h + GAP_Y
  })

  const place = (n: Node, left: number) => {
    n.x = left + (n.span - n.w) / 2
    n.y = rowY[n.depth] as number
    const kidsWidth = n.children.reduce((s, c) => s + c.span, 0) + GAP_X * Math.max(0, n.children.length - 1)
    let x = left + (n.span - kidsWidth) / 2
    for (const c of n.children) {
      place(c, x)
      x += c.span + GAP_X
    }
  }
  let left = 8
  for (const r of roots) {
    place(r, left)
    left += r.span + GAP_X * 2
  }

  const edges: Edge[] = []
  for (const node of nodes.values()) {
    ;[node.parent, ...node.extra].forEach((parentName, i) => {
      if (!parentName) return
      const parent = nodes.get(parentName) as Node
      const cx = node.x + node.w / 2
      const px = parent.x + parent.w / 2
      const mid = node.y - GAP_Y / 2
      const base = parent.y + parent.h + 11
      const pb = parent.y + parent.h
      edges.push({
        path: `M${cx} ${node.y} V${mid} H${px} V${base}`,
        arrow: `M${px} ${pb} L${px - 6} ${pb + 11} L${px + 6} ${pb + 11} Z`,
        secondary: i > 0,
      })
    })
  }
  return { nodes: [...nodes.values()], edges, width: left, height: y - GAP_Y + 8 }
}

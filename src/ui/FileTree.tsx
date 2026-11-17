import { useMemo, useState } from 'preact/hooks'
import type { FileEntry } from '../workspace'
import { t, useLang } from '../i18n'

const plain = (text: string) => text.replace(/\s*…$/, '')

interface Node {
  name: string
  path: string
  kind: 'file' | 'dir'
  children: Node[]
}

/** Folders first, then files, each alphabetical. */
export function buildTree(entries: readonly FileEntry[]): Node[] {
  const root: Node = { name: '', path: '', kind: 'dir', children: [] }
  const dirs = new Map<string, Node>([['', root]])
  const ensureDir = (path: string): Node => {
    const known = dirs.get(path)
    if (known) return known
    const cut = path.lastIndexOf('/')
    const node: Node = { name: path.slice(cut + 1), path, kind: 'dir', children: [] }
    ensureDir(path.slice(0, Math.max(cut, 0))).children.push(node)
    dirs.set(path, node)
    return node
  }
  for (const entry of entries) {
    if (entry.kind === 'dir') ensureDir(entry.path)
    else {
      const cut = entry.path.lastIndexOf('/')
      ensureDir(cut < 0 ? '' : entry.path.slice(0, cut)).children.push({ name: entry.path.slice(cut + 1), path: entry.path, kind: 'file', children: [] })
    }
  }
  const sort = (node: Node) => {
    node.children.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1))
    node.children.forEach(sort)
  }
  sort(root)
  return root.children
}

interface Props {
  entries: readonly FileEntry[]
  active: string | null
  dirty: ReadonlySet<string>
  onOpen: (path: string) => void
  onRename: (path: string) => void
  onDelete: (path: string) => void
}

export function FileTree({ entries, active, dirty, onOpen, onRename, onDelete }: Props) {
  useLang()
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const tree = useMemo(() => buildTree(entries), [entries])

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (!next.delete(path)) next.add(path)
      return next
    })

  const rows = (nodes: Node[], depth: number): preact.JSX.Element[] =>
    nodes.flatMap((node) => {
      const isOpen = node.kind === 'dir' && !collapsed.has(node.path)
      const row = (
        <li key={node.path} class={node.path === active ? 'row active' : 'row'} style={{ paddingLeft: `${6 + depth * 14}px` }}>
          {node.kind === 'dir' ? (
            <button type="button" class="row-main dir" aria-expanded={isOpen} onClick={() => toggle(node.path)}>
              <span class="twisty">{isOpen ? '▾' : '▸'}</span>
              {node.name}
            </button>
          ) : (
            <button type="button" class="row-main" onClick={() => onOpen(node.path)}>
              <span class="twisty" />
              {node.name}
              {dirty.has(node.path) && <span class="dot" role="img" aria-label={t('tabs.unsaved')}> ●</span>}
            </button>
          )}
          <span class="row-actions">
            <button type="button" title={t('files.rename')} aria-label={`${plain(t('files.rename'))} ${node.path}`} onClick={() => onRename(node.path)}>
              ✎
            </button>
            <button type="button" title={t('files.delete')} aria-label={`${plain(t('files.delete'))} ${node.path}`} onClick={() => onDelete(node.path)}>
              🗑
            </button>
          </span>
        </li>
      )
      return node.kind === 'dir' && isOpen ? [row, ...rows(node.children, depth + 1)] : [row]
    })

  return <ul class="tree">{rows(tree, 0)}</ul>
}

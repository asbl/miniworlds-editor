import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import type { FileEntry, Workspace } from '../workspace'
import { EditorHost } from './editorHost'

const SAMPLE = `import miniworlds

world = miniworlds.World(400, 300)

world.run()
`
const AUTOSAVE_MS = 500

export function App({ workspace }: { workspace: Workspace }) {
  const { fs } = workspace
  const [files, setFiles] = useState<FileEntry[]>([])
  const [open, setOpen] = useState<string[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [dirty, setDirty] = useState<ReadonlySet<string>>(new Set())

  const host = useRef<EditorHost | null>(null)
  const mount = useRef<HTMLDivElement>(null)
  const latest = useRef(new Map<string, string>())
  const timers = useRef(new Map<string, number>())

  const refresh = useCallback(async () => setFiles(await fs.list()), [fs])

  const setClean = (path: string) =>
    setDirty((prev) => {
      const next = new Set(prev)
      next.delete(path)
      return next
    })

  const save = useCallback(
    async (path: string) => {
      const text = latest.current.get(path)
      if (text === undefined) return
      window.clearTimeout(timers.current.get(path))
      timers.current.delete(path)
      await fs.write(path, text)
      latest.current.delete(path)
      setClean(path)
    },
    [fs],
  )

  const onChange = useCallback(
    (path: string, text: string) => {
      latest.current.set(path, text)
      setDirty((prev) => new Set(prev).add(path))
      window.clearTimeout(timers.current.get(path))
      timers.current.set(path, window.setTimeout(() => void save(path), AUTOSAVE_MS))
    },
    [save],
  )

  // Mount CodeMirror once.
  useEffect(() => {
    const editor = new EditorHost(mount.current as HTMLElement, onChange)
    host.current = editor
    return () => editor.destroy()
  }, [onChange])

  // Initial load; seed an empty project with a sample.
  useEffect(() => {
    void (async () => {
      let list = await fs.list()
      if (list.length === 0) {
        await fs.write('main.py', SAMPLE)
        list = await fs.list()
      }
      setFiles(list)
      const first = list.find((e) => e.kind === 'file')
      if (first) await openFile(first.path)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Flush pending edits when the page goes away.
  useEffect(() => {
    const flush = () => [...latest.current.keys()].forEach((p) => void save(p))
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [save])

  async function show(path: string) {
    const text = latest.current.get(path) ?? (await fs.read(path))
    host.current?.show(path, text)
    setActive(path)
  }

  async function openFile(path: string) {
    setOpen((prev) => (prev.includes(path) ? prev : [...prev, path]))
    await show(path)
  }

  async function closeTab(path: string) {
    await save(path)
    host.current?.forget(path)
    const remaining = open.filter((p) => p !== path)
    setOpen(remaining)
    if (active === path) {
      const next = remaining[remaining.length - 1]
      if (next) await show(next)
      else {
        host.current?.clear()
        setActive(null)
      }
    }
  }

  async function newFile() {
    const name = window.prompt('Dateiname (z. B. classes/Crab.py)')
    if (!name) return
    try {
      if (!(await fs.exists(name))) await fs.write(name, '')
      await refresh()
      await openFile(name.replace(/^\/+/, ''))
    } catch (error) {
      window.alert(String(error))
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key === 's') {
      event.preventDefault()
      if (active) void save(active)
    }
  }

  return (
    <div class="app" onKeyDown={onKeyDown}>
      <aside class="sidebar" aria-label="Dateien">
        <div class="sidebar-head">
          <span>Dateien</span>
          <button type="button" onClick={() => void newFile()} title="Neue Datei">
            +
          </button>
        </div>
        <ul>
          {files.map((entry) => {
            const depth = entry.path.split('/').length - 1
            const name = entry.path.split('/').pop()
            return (
              <li
                key={entry.path}
                class={entry.path === active ? 'active' : ''}
                style={{ paddingLeft: `${8 + depth * 14}px` }}
              >
                {entry.kind === 'dir' ? (
                  <span class="dir">{name}/</span>
                ) : (
                  <button type="button" onClick={() => void openFile(entry.path)}>
                    {name}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </aside>
      <main class="main">
        <div class="tabs" role="tablist">
          {open.map((path) => (
            <div
              key={path}
              role="tab"
              aria-selected={path === active}
              class={path === active ? 'tab active' : 'tab'}
            >
              <button type="button" class="tab-name" onClick={() => void show(path)}>
                {path}
                {dirty.has(path) ? ' ●' : ''}
              </button>
              <button
                type="button"
                class="tab-close"
                aria-label={`${path} schließen`}
                onClick={() => void closeTab(path)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div class="editor" ref={mount} />
        <div class="status">Speicher: {workspace.kind}</div>
      </main>
    </div>
  )
}

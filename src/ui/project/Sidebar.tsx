import { useMemo, useRef } from 'preact/hooks'
import { t, useLang } from '../../i18n'
import type { Snapshot } from '../../history/history'
import { HistoryPanel } from '../../history/HistoryPanel'
import type { useHistory } from '../../history/useHistory'
import type { ProjectKind } from '../../project/manifest'
import type { FileEntry } from '../../workspace'
import { FileTree } from '../FileTree'
import { Menu, type MenuItem } from '../Menu'
import { SearchPanel } from '../SearchPanel'
import type { Session } from '../session'
import type { ComponentChildren } from 'preact'

export type SidebarTab = 'files' | 'search' | 'classes' | 'history'

interface Props {
  tab: SidebarTab
  onTab: (tab: SidebarTab) => void
  kind: ProjectKind
  entries: FileEntry[]
  session: Session | null
  active: string | null
  dirty: ReadonlySet<string>
  historyApi: ReturnType<typeof useHistory>
  searchSignal: number
  onOpenSearch: () => void
  onOpenFile: (path: string) => void
  onNewFile: () => void
  onNewClass: () => void
  onAddFiles: (files: FileList) => Promise<void>
  onRename: (path: string) => void
  onDelete: (path: string) => void
  onOpenSnapshot: (snapshot: Snapshot) => void
  onSaveVersion: () => void
  onChanged: () => void
  /** The class diagram (it needs much of the project's state, so the parent builds it). */
  classes: ComponentChildren
}

/** The left column: files, class diagram, search and history in one place, one at a time. */
export function Sidebar(p: Props) {
  const lang = useLang()
  const upload = useRef<HTMLInputElement>(null)
  const addMenu = useMemo<MenuItem[]>(
    () => [
      { label: t('files.newFile'), onSelect: p.onNewFile },
      { label: t('files.newClass'), onSelect: p.onNewClass, disabled: p.kind !== 'project' },
      { label: t('files.upload'), onSelect: () => upload.current?.click(), divider: true },
    ],
    // the handlers are recreated on every render; what matters is what they use
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lang, p.kind, p.session, p.entries],
  )
  const { tab } = p
  return (
    <section class={tab === 'classes' ? 'sidebar wide' : 'sidebar'} aria-label={t('a11y.sidebar')}>
      <div class="sidebar-tabs">
        <div class="tab-list" role="tablist" aria-label={t('a11y.sidebar')}>
          <button type="button" role="tab" aria-selected={tab === 'files'} onClick={() => p.onTab('files')}>
            {t('files.title')}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'classes'} onClick={() => p.onTab('classes')}>
            {t('uml.title')}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'search'} onClick={p.onOpenSearch} title="Ctrl+Shift+F">
            {t('search.title')}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'history'} onClick={() => (p.onTab('history'), void p.historyApi.reload())}>
            {t('history.title')}
          </button>
        </div>
        {tab === 'files' && <Menu label="+" title={t('files.newFile')} items={addMenu} align="right" />}
      </div>
      {p.kind === 'legacy' && <p class="badge">{t('project.legacyBadge')}</p>}
      {tab === 'classes' ? (
        p.classes
      ) : tab === 'files' ? (
        <FileTree entries={p.entries} active={p.active} dirty={p.dirty} onOpen={p.onOpenFile} onRename={p.onRename} onDelete={p.onDelete} />
      ) : tab === 'history' ? (
        <HistoryPanel snapshots={p.historyApi.snapshots} available={p.historyApi.history !== null} onOpen={p.onOpenSnapshot} onSave={p.onSaveVersion} />
      ) : (
        p.session && <SearchPanel session={p.session} focusSignal={p.searchSignal} onChanged={p.onChanged} />
      )}
      <input
        ref={upload}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const input = e.currentTarget
          if (input.files) void p.onAddFiles(input.files).then(() => (input.value = ''))
        }}
      />
    </section>
  )
}

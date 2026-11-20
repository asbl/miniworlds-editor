import { useEffect, useRef, useState } from 'preact/hooks'
import type { Lang } from '../../i18n'
import { ENTRY_DEFAULT } from '../../project/manifest'
import type { Fs } from '../../workspace'
import { EditorHost } from '../editorHost'
import { Session } from '../session'
import { isSyncedFs } from '../../collab/shared'
import type { Collab } from '../../collab/collab'

interface Args {
  fs: Fs
  collab?: Collab | null
  lang: Lang
  /** The parent calls the registered function to flush unsaved edits before export, switching projects, etc. */
  registerFlush: (flush: (() => Promise<void>) | null) => void
  /** Also flush what belongs to the project but not to a file (miniworlds.json). */
  flushMeta: { current: () => Promise<void> }
  refresh: () => Promise<void>
  onCursor: (position: { path: string; line: number }) => void
  onProblems: (count: number) => void
}

/** The code editor and the session (open files, saving) of one project: created when the project opens, destroyed when it closes. */
export function useEditorSession({ fs, collab, lang, registerFlush, flushMeta, refresh, onCursor, onProblems }: Args) {
  const mount = useRef<HTMLDivElement>(null)
  const host = useRef<EditorHost | null>(null)
  const [session, setSession] = useState<Session | null>(null)

  useEffect(() => {
    let sess: Session | null = null
    const editor = new EditorHost(mount.current as HTMLElement, (path, text) => sess?.edit(path, text), lang, (path, line) => onCursor({ path, line }))
    host.current = editor
    if (collab) {
      editor.setCollab(collab.editorSource())
      editor.setLocked(collab.locked)
    }
    editor.onProblems = onProblems
    sess = new Session(fs, editor, undefined, isSyncedFs(fs) ? fs.mirror : fs)
    setSession(sess)
    registerFlush(async () => {
      await (sess as Session).saveAll()
      await flushMeta.current()
    })
    void (async () => {
      await refresh()
      const list = await fs.list()
      const first = list.find((e) => e.path === ENTRY_DEFAULT) ?? list.find((e) => e.kind === 'file')
      if (first) await sess.open(first.path)
    })()
    const flush = () => void sess?.saveAll()
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      registerFlush(null)
      void sess?.saveAll().finally(() => sess?.dispose())
      editor.destroy()
      host.current = null
    }
    // one editor per project: only a different file system starts over
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fs])

  useEffect(() => host.current?.setLang(lang), [lang])

  return { mount, host, session }
}

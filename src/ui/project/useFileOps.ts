import type { Fs } from '../../workspace'
import { renamePath, uniquePath } from '../../workspace'
import { t } from '../../i18n'
import { addImport, classNameProblem, classPath, classSource, removeImport, subclassSource, CLASS_DIR, type BaseClass, type ClassKind } from '../../project/classes'
import type { ProjectKind } from '../../project/manifest'
import { ENTRY_DEFAULT } from '../../project/manifest'
import { isImagePath } from '../../project/search'
import { recordSource } from '../../miniworlds/provenance'
import type { useMiniworldsMeta } from '../../miniworlds/useMiniworlds'
import type { useHistory } from '../../history/useHistory'
import type { FileEntry } from '../../workspace'
import { confirmDialog, infoDialog, openDialog } from '../dialogs'
import type { Session } from '../session'
import { reportError } from './reportError'

interface Args {
  fs: Fs
  session: Session | null
  entries: FileEntry[]
  kind: ProjectKind
  refresh: () => Promise<void>
  metaApi: ReturnType<typeof useMiniworldsMeta>
  historyApi: ReturnType<typeof useHistory>
}

/** Create, add, rename and delete files and classes (the dialogs and what follows from them). */
export function useFileOps({ fs, session, entries, kind, refresh, metaApi, historyApi }: Args) {
  async function newFile(prefill = '') {
    const values = await openDialog({
      title: t('files.newFile'),
      fields: [{ kind: 'text', key: 'path', label: t('files.path'), initial: prefill }],
      submit: 'dialog.create',
      validate: async (v) => {
        const path = String(v.path).trim().replace(/^\/+/, '')
        if (path === '' || path.split('/').includes('..') || path.endsWith('/')) return t('project.invalidName')
        return (await fs.exists(path)) ? t('files.exists', { path }) : null
      },
    })
    if (!values) return
    const path = String(values.path).trim().replace(/^\/+/, '')
    try {
      await fs.write(path, '')
      await refresh()
      await session?.open(path)
    } catch (error) {
      await reportError(error)
    }
  }

  async function newClass(base?: BaseClass) {
    if (kind !== 'project') return void (await infoDialog(t('class.title'), t('class.onlyInProject')))
    const hasMain = await fs.exists(ENTRY_DEFAULT)
    const values = await openDialog({
      title: base ? t('class.subclassOf', { name: base.name }) : t('class.title'),
      fields: [
        { kind: 'text', key: 'name', label: t('class.name') },
        ...(base
          ? []
          : [
              {
                kind: 'select' as const,
                key: 'kind',
                label: t('class.kind'),
                initial: 'actor',
                options: [
                  { value: 'actor', label: t('class.kind.actor') },
                  { value: 'world', label: t('class.kind.world') },
                  { value: 'plain', label: t('class.kind.plain') },
                ],
              },
            ]),
        ...(hasMain ? [{ kind: 'checkbox' as const, key: 'import', label: t('class.addImport'), initial: true }] : []),
      ],
      submit: 'dialog.create',
      validate: async (v) => {
        const name = String(v.name).trim()
        const problem = classNameProblem(name)
        if (problem === 'invalid') return t('class.invalid')
        if (problem === 'reserved') return t('class.reserved', { name })
        return (await fs.exists(classPath(name))) ? t('files.exists', { path: classPath(name) }) : null
      },
    })
    if (!values) return
    const name = String(values.name).trim()
    try {
      await fs.write(classPath(name), base ? subclassSource(name, base) : classSource(values.kind as ClassKind, name))
      if (values.import && hasMain) await session?.writeText(ENTRY_DEFAULT, addImport(await (session as Session).readText(ENTRY_DEFAULT), name))
      await refresh()
      await session?.open(classPath(name))
    } catch (error) {
      await reportError(error)
    }
  }

  async function addFiles(files: FileList | File[]) {
    try {
      let last: string | null = null
      for (const file of Array.from(files)) {
        const folder = isImagePath(file.name) ? 'images/' : ''
        last = await uniquePath(fs, folder + file.name)
        await fs.write(last, new Uint8Array(await file.arrayBuffer()))
        // a dropped-in picture is somebody's picture until the pupil says otherwise when sharing
        if (isImagePath(last)) metaApi.setMeta({ ...metaApi.metaRef.current, images: recordSource(metaApi.metaRef.current.images, last, { source: 'upload' }) })
      }
      await refresh()
      if (last) await session?.open(last)
    } catch (error) {
      await reportError(error)
    }
  }

  async function renameEntry(path: string) {
    const isDir = entries.find((e) => e.path === path)?.kind === 'dir'
    const values = await openDialog({
      title: t('files.rename'),
      message: t('files.renameTo', { path }),
      fields: [{ kind: 'text', key: 'to', label: t('files.path'), initial: path }],
      validate: async (v) => {
        const to = String(v.to).trim().replace(/^\/+/, '')
        if (to === '' || to.split('/').includes('..')) return t('project.invalidName')
        if (to === path) return null
        const clash = isDir ? entries.some((e) => e.path === to || e.path.startsWith(to + '/')) : await fs.exists(to)
        return clash ? t('files.exists', { path: to }) : null
      },
    })
    if (!values) return
    const to = String(values.to).trim().replace(/^\/+/, '')
    if (to === path) return
    try {
      await session?.saveAll()
      await renamePath(fs, path, to)
      await session?.moved(path, to)
      await refresh()
    } catch (error) {
      await reportError(error)
    }
  }

  async function deleteEntry(path: string) {
    if (!(await confirmDialog(t('files.delete'), t('files.deleteConfirm', { path })))) return
    await historyApi.record('before-delete')
    try {
      await fs.remove(path)
      await session?.removed(path)
      // a deleted class file would leave a dangling import in main.py
      const m = new RegExp(`^${CLASS_DIR}/([A-Za-z_][A-Za-z0-9_]*)\\.py$`).exec(path)
      if (m && kind === 'project' && session && (await fs.exists(ENTRY_DEFAULT))) {
        const main = await session.readText(ENTRY_DEFAULT)
        const cleaned = removeImport(main, m[1] as string)
        if (cleaned !== main) await session.writeText(ENTRY_DEFAULT, cleaned)
      }
      await refresh()
    } catch (error) {
      await reportError(error)
    }
  }

  return { newFile, newClass, addFiles, renameEntry, deleteEntry }
}

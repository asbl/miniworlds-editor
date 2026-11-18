import { t } from '../../i18n'
import { classNameProblem, classPath } from '../../project/classes'
import type { ProjectKind } from '../../project/manifest'
import { findNameClash, renameClass } from '../../project/renameClass'
import type { useMiniworldsMeta } from '../../miniworlds/useMiniworlds'
import type { useHistory } from '../../history/useHistory'
import type { Runner } from '../../runtime/runner'
import type { ModelClass } from '../../uml/model'
import type { useClassModel } from '../../uml/useModel'
import { renamePath, type Fs } from '../../workspace'
import { infoDialog, openDialog } from '../dialogs'
import type { Session } from '../session'
import { reportError } from './reportError'

interface Args {
  fs: Fs
  session: Session | null
  kind: ProjectKind
  runner: Runner
  classModel: ReturnType<typeof useClassModel>
  metaApi: ReturnType<typeof useMiniworldsMeta>
  historyApi: ReturnType<typeof useHistory>
  refresh: () => Promise<void>
  /** The class that is selected in the diagram follows its new name. */
  onRenamed: (name: string) => void
}

/** Renames a class everywhere: definition, uses, imports, its file, and the start setup of the world. */
export function useRenameClass({ fs, session, kind, runner, classModel, metaApi, historyApi, refresh, onRenamed }: Args) {
  return async function renameClassDialog(info: ModelClass) {
    if (kind !== 'project') return void (await infoDialog(t('class.title'), t('class.onlyInProject')))
    // what is in the files now (including what was just typed), to see whether the new name is already used for something else
    await session?.saveAll()
    const texts: Record<string, string> = {}
    for (const entry of await fs.list()) if (entry.kind === 'file' && entry.path.endsWith('.py')) texts[entry.path] = await fs.read(entry.path)
    const taken = async (name: string) => (classModel.model?.classes.some((c) => c.name === name) ?? false) || (await fs.exists(classPath(name)))
    const values = await openDialog({
      title: t('class.renameTitle', { name: info.name }),
      message: t('class.renameHint'),
      fields: [{ kind: 'text', key: 'name', label: t('class.name'), initial: info.name }],
      submit: 'dialog.rename',
      validate: async (v) => {
        const name = String(v.name).trim()
        if (name === info.name) return null
        const problem = classNameProblem(name)
        if (problem === 'invalid') return t('class.invalid')
        if (problem === 'reserved') return t('class.reserved', { name })
        if (await taken(name)) return t('class.exists', { name })
        const clash = findNameClash(texts, name)
        if (clash?.kind === 'builtin') return t('class.builtin', { name })
        return clash ? t('class.clash', { name, file: clash.path, line: clash.line }) : null
      },
    })
    const name = values ? String(values.name).trim() : info.name
    if (!values || name === info.name) return
    try {
      await historyApi.record('before-rename')
      const result = renameClass(texts, info.name, name)
      for (const [path, text] of Object.entries(result.texts)) await (session ? session.writeText(path, text) : fs.write(path, text))
      if (result.move) {
        await renamePath(fs, result.move.from, result.move.to)
        await session?.moved(result.move.from, result.move.to)
      }
      // objects placed in the world by hand are remembered by class name
      const meta = metaApi.metaRef.current
      if (meta.journal.some((op) => 'cls' in op && op.cls === info.name)) {
        metaApi.setMeta({ ...meta, journal: meta.journal.map((op) => ('cls' in op && op.cls === info.name ? { ...op, cls: name } : op)) })
      }
      onRenamed(name)
      await refresh()
      runner.note(t('class.renamed', { count: result.count, files: Object.keys(result.texts).length }))
    } catch (error) {
      await reportError(error)
    }
  }
}

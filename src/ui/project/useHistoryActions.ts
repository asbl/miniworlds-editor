import { useState } from 'preact/hooks'
import { t } from '../../i18n'
import type { Fs } from '../../workspace'
import type { Snapshot } from '../../history/history'
import { readTexts, restoreAll, restoreFile } from '../../history/restore'
import type { useHistory } from '../../history/useHistory'
import { confirmDialog, infoDialog, openDialog } from '../dialogs'
import type { Session } from '../session'
import { reportError } from './reportError'

export interface ViewedSnapshot {
  snapshot: Snapshot
  old: Record<string, string>
  current: Record<string, string>
}

/** What a pupil can do with the saved states: look at one, name it, delete it, bring back a file or everything. */
export function useHistoryActions(fs: Fs, session: Session | null, historyApi: ReturnType<typeof useHistory>, refresh: () => Promise<void>, shared = false) {
  const [viewing, setViewing] = useState<ViewedSnapshot | null>(null)

  async function openSnapshot(snapshot: Snapshot) {
    if (!historyApi.history || !session) return
    try {
      setViewing({ snapshot, old: await historyApi.history.read(snapshot.id), current: await readTexts(fs, session) })
    } catch (error) {
      await reportError(error)
    }
  }

  async function saveVersion() {
    const values = await openDialog({
      title: t('history.save'),
      message: t('history.saveHint'),
      fields: [{ kind: 'text', key: 'name', label: t('history.saveName'), initial: '' }],
      validate: (v) => (String(v.name).trim() === '' ? t('project.invalidName') : null),
    })
    if (values) await historyApi.record('manual', String(values.name).trim())
  }

  async function labelVersion(snapshot: Snapshot) {
    const values = await openDialog({ title: t('history.rename'), fields: [{ kind: 'text', key: 'name', label: t('history.saveName'), initial: snapshot.label ?? '' }] })
    if (!values || !historyApi.history) return
    await historyApi.history.label(snapshot.id, String(values.name))
    await historyApi.reload()
    setViewing(null)
  }

  async function removeVersion(snapshot: Snapshot) {
    if (!historyApi.history || !(await confirmDialog(t('history.delete'), t('history.deleteConfirm')))) return
    await historyApi.history.remove(snapshot.id)
    await historyApi.reload()
    setViewing(null)
  }

  async function restoreOne(path: string) {
    if (!viewing || !historyApi.history || !session) return
    try {
      await restoreFile({ fs, session, history: historyApi.history }, viewing.snapshot.id, path)
      await refresh()
      await historyApi.reload()
      setViewing({ ...viewing, current: await readTexts(fs, session) })
      await infoDialog(t('history.title'), t('history.restored', { path }))
    } catch (error) {
      await reportError(error)
    }
  }

  async function restoreEverything() {
    if (!viewing || !historyApi.history || !session) return
    if (!(await confirmDialog(t('history.restoreAll'), t('history.restoreAllConfirm') + (shared ? ` ${t('history.restoreAllShared')}` : ''), false))) return
    try {
      await restoreAll({ fs, session, history: historyApi.history }, viewing.snapshot.id)
      await refresh()
      await historyApi.reload()
      setViewing(null)
      await infoDialog(t('history.title'), t('history.restoredAll'))
    } catch (error) {
      await reportError(error)
    }
  }

  /** "Back to the last version that ran": asks first; the state before is remembered by `restoreAll`, so this can be undone in the history. */
  async function restoreWorked(snapshot: Snapshot) {
    if (!historyApi.history || !session) return
    if (!(await confirmDialog(t('history.restoreWorked'), t('history.restoreWorkedConfirm') + (shared ? ` ${t('history.restoreAllShared')}` : ''), false))) return
    try {
      await restoreAll({ fs, session, history: historyApi.history }, snapshot.id)
      await refresh()
      await historyApi.reload()
    } catch (error) {
      await reportError(error)
    }
  }

  return { restoreWorked, viewing, close: () => setViewing(null), openSnapshot, saveVersion, labelVersion, removeVersion, restoreOne, restoreEverything }
}

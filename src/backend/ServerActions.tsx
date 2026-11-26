import { useEffect, useState } from 'preact/hooks'
import { useLang } from '../i18n'
import { HistoryDialog } from '../history/HistoryDialog'
import { confirmDialog, infoDialog, openDialog } from '../ui/dialogs'
import type { BackendConnection } from './projects'
import { restoreVersion, serverHistory, serverVersion, type ServerCommit, type ShareState } from './server'

interface Props {
  base: string
  connection: BackendConnection
  busy: boolean
  perform: (action: () => Promise<void>) => Promise<void>
  flush: () => Promise<void>
  onOpen: (name: string) => Promise<void>
}

/** Version history kept on the server, and the request to publish a project. */
export function ServerActions({ base, connection, busy, perform, flush, onOpen }: Props) {
  const lang = useLang()
  const tr = (de: string, en: string) => lang === 'de' ? de : en
  const [viewing, setViewing] = useState<{ commit: ServerCommit; old: Record<string, string>; current: Record<string, string> } | null>(null)
  useEffect(() => setViewing(null), [connection])
  const when = (date: string) => new Date(date).toLocaleString(lang)

  async function showHistory() {
    await flush(); await connection.sync()
    const { commits, paused } = await serverHistory(connection)
    if (!commits.length) return infoDialog(tr('Serververlauf', 'Server history'), tr('Noch keine früheren Stände gespeichert.', 'No earlier versions saved yet.'))
    const values = await openDialog({
      title: tr('Serververlauf', 'Server history'),
      message: paused ? tr('Der Verlauf ist voll: neue Stände werden nicht mehr aufgenommen. Dein aktuelles Projekt wird weiter gespeichert.', 'The history is full: no new versions are added. Your current project is still saved.') : tr('Frühere Stände dieses Projekts, auch von anderen Geräten.', 'Earlier versions of this project, including those from other devices.'),
      fields: [{ kind: 'select', key: 'hash', label: tr('Stand', 'Version'), initial: commits[0]!.hash, options: commits.map(c => ({ value: c.hash, label: when(c.date) + (c.message.startsWith('Speichern am ') ? '' : ` · ${c.message}`) })) }],
    })
    if (!values) return
    const commit = commits.find(c => c.hash === values.hash)!
    setViewing({ commit, ...await serverVersion(connection, commit.hash, connection.local.fs) })
  }

  async function restore(commit: ServerCommit) {
    setViewing(null)
    if (!await confirmDialog(tr('Diesen Stand wiederherstellen?', 'Restore this version?'), tr(`Das Projekt wird auf den Stand vom ${when(commit.date)} zurückgesetzt. Der jetzige Stand bleibt im Serververlauf.`, `The project is reset to the version of ${when(commit.date)}. The present version stays in the server history.`))) return
    await perform(async () => {
      await flush()
      await restoreVersion(connection, commit.hash)
      await onOpen(connection.name)
    })
  }

  async function publish() {
    await flush(); await connection.sync()
    if (connection.dirty) throw new Error(tr('Bitte den Projektstand zuerst erfolgreich speichern.', 'Save the project successfully first.'))
    const state = await connection.client.json<ShareState>('/api/play/share-status')
    const title = tr('Projekt veröffentlichen', 'Publish project')
    if (state.status === 'pending') return infoDialog(title, tr('Dein Antrag wartet auf die Prüfung durch deine Lehrkraft.', 'Your request is waiting for your teacher to check it.'))
    const before = state.status === 'approved' ? tr(`Öffentlich unter ${base}/p/${state.slug}\n\nDu kannst den jetzigen Stand erneut zur Prüfung einreichen.`, `Public at ${base}/p/${state.slug}\n\nYou can submit the present version for another check.`)
      : state.status === 'rejected' ? tr('Der letzte Antrag wurde abgelehnt.', 'The last request was declined.')
      : state.status === 'revoked' ? tr('Die Veröffentlichung wurde zurückgezogen.', 'The publication was withdrawn.') : ''
    const values = await openDialog({
      title,
      message: [before, tr('Nach der Freigabe durch deine Lehrkraft kann jeder alle Dateien dieses Projekts sehen (auch Datenbanken wie save.db). Schreibe keine Namen oder anderen persönlichen Angaben hinein. Nenne Quellen und Lizenzen fremder Bilder und Töne in einer Datei QUELLEN.txt.', 'Once your teacher approves it, anyone can see all files of this project (including databases such as save.db). Do not include names or other personal details. List sources and licences of other people’s pictures and sounds in a file QUELLEN.txt.'), state.declaration_text].filter(Boolean).join('\n\n'),
      fields: [{ kind: 'checkbox', key: 'accepted', label: tr('Ich bestätige diese Versicherung', 'I confirm this declaration'), initial: false }],
      validate: v => v.accepted ? null : tr('Bitte zuerst bestätigen.', 'Please confirm first.'),
    })
    if (!values) return
    await connection.client.json('/api/play/share-request', 'POST', { declaration_accepted: true })
    await infoDialog(title, tr('Der Antrag ist bei deiner Lehrkraft. Sie prüft den Stand, den dein Projekt dann hat.', 'Your request has been sent. Your teacher checks the project as it is at that time.'))
  }

  return <>
    <button type="button" disabled={busy} onClick={() => void perform(showHistory)}>{tr('Serververlauf', 'Server history')}</button>
    <button type="button" disabled={busy} onClick={() => void perform(publish)}>{tr('Veröffentlichen', 'Publish')}</button>
    {viewing && <HistoryDialog
      snapshot={{ id: viewing.commit.hash, time: Date.parse(viewing.commit.date), reason: 'manual', label: tr('Serverstand', 'Server version'), files: {}, size: 0 }}
      old={viewing.old} current={viewing.current}
      onRestoreAll={connection.project.read_only ? undefined : () => void restore(viewing.commit)}
      onClose={() => setViewing(null)} />}
  </>
}

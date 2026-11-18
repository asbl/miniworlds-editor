import { t } from '../../i18n'
import type { Lang } from '../../i18n'
import { ENTRY_DEFAULT } from '../../project/manifest'
import type { Runner } from '../../runtime/runner'
import type { FileEntry, Fs } from '../../workspace'
import type { useSettings } from '../useSettings'
import { openDialog } from '../dialogs'
import { buildReport } from '../report'
import type { Session } from '../session'

interface Args {
  fs: Fs
  session: Session | null
  runner: Runner
  lang: Lang
  settings: ReturnType<typeof useSettings>['settings']
  entries: FileEntry[]
}

/** A text the pupil can send to a teacher: versions, files, the start file and the console. */
export function useReport({ fs, session, runner, lang, settings, entries }: Args) {
  return async function copyReport() {
    const text = buildReport({
      time: new Date(),
      lang,
      userAgent: navigator.userAgent,
      engine: runner.state.version,
      pinned: settings.miniworlds ?? null,
      packages: settings.packages,
      files: entries.filter((e) => e.kind === 'file').map((e) => e.path),
      entry: (await fs.exists(ENTRY_DEFAULT)) ? { path: ENTRY_DEFAULT, text: await (session ? session.readText(ENTRY_DEFAULT) : fs.read(ENTRY_DEFAULT)) } : null,
      lines: runner.state.lines,
    })
    try {
      await navigator.clipboard.writeText(text)
      runner.note(t('console.reportCopied'))
    } catch {
      // clipboard blocked (iframe, insecure context): show the text to copy by hand
      await openDialog({ title: t('console.reportTitleDialog'), message: t('console.reportManual'), body: <textarea class="report-text" readOnly rows={14} value={text} onFocus={(e) => e.currentTarget.select()} />, info: true })
    }
  }
}

import type { Lang } from '../i18n'
import { t } from '../i18n'
import { engineHintToIssue, jediToItems, mergeIssues, ruffToIssues, type CompletionItem, type Issue } from './convert'
import type { LanguageService } from './service'

/** What the editor asks for; implemented on top of the language service. Every answer may be empty. */
export interface Assist {
  complete(path: string, source: string, line: number, col: number): Promise<CompletionItem[]>
  hover(path: string, source: string, line: number, col: number): Promise<{ name: string; doc: string } | null>
  /** Problems of one file: miniworlds hints (they know the whole project) plus ruff. */
  lint(path: string, source: string): Promise<Issue[]>
  format(source: string): Promise<string | null>
  /** Low-memory mode: the editor help sleeps; editing wakes it. */
  wake(): void
  dormant(): boolean
}

export interface AssistDeps {
  service: LanguageService
  /** All Python sources of the project as the user sees them (unsaved edits included). */
  files: () => Promise<Record<string, string>>
  lang: () => Lang
}

export function createAssist({ service, files, lang }: AssistDeps): Assist {
  return {
    async complete(path, source, line, col) {
      return jediToItems(await service.complete(path, source, line, col))
    },
    async hover(path, source, line, col) {
      const h = await service.hover(path, source, line, col)
      return h && h.doc ? { name: h.name, doc: h.doc } : null
    },
    async lint(path, source) {
      if (service.dormant) return [] // looking at a file is no reason to start the help
      const lines = source.split('\n')
      const [engine, ruff] = await Promise.all([
        service.state.hints ? files().then((all) => service.hints({ ...all, [path]: source })) : Promise.resolve([]),
        service.lint(source),
      ])
      const own = engine.filter((h) => h.file === path).map((h) => engineHintToIssue(h, (r) => t('assist.apply', { text: r })))
      return mergeIssues(own, ruffToIssues(ruff, lines, lang(), () => t('assist.fixRuff')))
    },
    format: (source) => service.format(source),
    wake: () => service.wake(),
    dormant: () => service.dormant,
  }
}

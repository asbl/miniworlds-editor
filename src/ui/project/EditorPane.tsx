import type { Ref } from 'preact'
import { t } from '../../i18n'
import { BlocksMenu } from '../../blocks/BlocksMenu'
import type { LanguageService } from '../../language/service'
import type { useLanguage } from '../../language/useLanguage'
import { isTextPath } from '../../project/search'
import type { Fs } from '../../workspace'
import { infoDialog } from '../dialogs'
import type { EditorHost } from '../editorHost'
import { BinaryViewer } from '../ImageViewer'
import type { Session, SessionState } from '../session'

interface Props {
  fs: Fs
  session: Session | null
  state: SessionState
  mount: Ref<HTMLDivElement>
  host: { current: EditorHost | null }
  language: LanguageService
  languageState: ReturnType<typeof useLanguage>
  problems: number
  embedded: boolean
  memoryOnly: boolean
}

/** The middle column: file tabs, the code (or a picture), and the status line. */
export function EditorPane({ fs, session, state, mount, host, language, languageState, problems, embedded, memoryOnly }: Props) {
  const active = state.active
  const showBinary = active !== null && !isTextPath(active)
  const isPython = active !== null && active.endsWith('.py')
  return (
    <div class="main">
      <div class="tabs">
        <div class="tab-list" role="tablist" aria-label={t('a11y.fileTabs')}>
          {state.open.map((path) => (
            <div key={path} class={path === active ? 'tab active' : 'tab'}>
              <button
                type="button"
                role="tab"
                aria-selected={path === active}
                aria-keyshortcuts="Delete"
                class="tab-name"
                onClick={() => void session?.show(path)}
                onAuxClick={(e) => e.button === 1 && void session?.close(path)}
                onKeyDown={(e) => {
                  if (e.key === 'Delete') {
                    e.preventDefault()
                    void session?.close(path)
                  }
                }}
              >
                {path}
                {state.dirty.has(path) && (
                  <span class="dot" role="img" aria-label={t('tabs.unsaved')}>
                    {' '}
                    ●
                  </span>
                )}
                {/* not a second control inside the tab: a mouse and touch convenience; the keyboard closes with Delete, the middle button too */}
                <span
                  class="tab-close"
                  aria-hidden="true"
                  title={t('tabs.close', { path })}
                  onClick={(e) => {
                    e.stopPropagation()
                    void session?.close(path)
                  }}
                >
                  ×
                </span>
              </button>
            </div>
          ))}
        </div>
        <span class="spacer" />
        {isPython && !showBinary && (
          <BlocksMenu
            onInsert={(block) => {
              if (!host.current?.insertBlock(block)) void infoDialog(t('blocks.button'), t('blocks.noClass'))
            }}
          />
        )}
        {languageState.ruff && isPython && (
          <button type="button" class="format-button" title={t('assist.formatTitle')} onClick={() => void host.current?.format()}>
            {t('assist.format')}
          </button>
        )}
      </div>
      <div class="editor" ref={mount} hidden={active === null || showBinary} />
      {showBinary && active && <BinaryViewer fs={fs} path={active} />}
      {active === null && <p class="empty">{t('tabs.none')}</p>}
      <div class="status">
        <span>{embedded ? '' : t(memoryOnly ? 'status.storage.memory' : 'status.storage.opfs')}</span>
        {isPython && (
          <button
            type="button"
            class="status-problems"
            onClick={() => (languageState.phase === 'dormant' ? language.wake() : host.current?.openProblems())}
            disabled={languageState.phase !== 'ready' && languageState.phase !== 'dormant'}
          >
            {languageState.phase === 'dormant'
              ? t('assist.dormant')
              : languageState.phase === 'booting' || languageState.phase === 'idle'
                ? t('assist.booting')
                : languageState.phase === 'error'
                  ? t('assist.error')
                  : problems > 0
                    ? `⚠ ${t('assist.problems', { n: problems })}`
                    : `✓ ${t('assist.noProblems')}${languageState.python ? '' : ` (${t('assist.partial')})`}`}
          </button>
        )}
        <span>{state.dirty.size > 0 ? t('status.saving') : t('status.saved')}</span>
      </div>
    </div>
  )
}

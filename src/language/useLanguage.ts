import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { getLang } from '../i18n'
import type { Runner } from '../runtime/runner'
import { readSources } from '../uml/useModel'
import type { EditorHost } from '../ui/editorHost'
import type { Session } from '../ui/session'
import type { Fs } from '../workspace'
import { createAssist } from './assist'
import type { LanguageService, LanguageState } from './service'

const FALLBACK_BOOT_MS = 6000
const SYNC_DELAY_MS = 300

interface Args {
  language: LanguageService
  runner: Runner
  fs: Fs
  session: Session | null
  host: { current: EditorHost | null }
  /** Installed miniworlds version of the world worker, once it has booted. */
  installedVersion: string | null
  /** Version to use if the world worker is slow (pinned or newest known). */
  configuredVersion: string | null
  /** The engine has the API index (full tier). */
  hasApiIndex: boolean
  /** Changes when files are added, renamed or removed. */
  fileSignal: unknown
}

/** Boots the language worker after the world, feeds it the project and the engine's API index, connects it to the editor. */
export function useLanguage({ language, runner, fs, session, host, installedVersion, configuredVersion, hasApiIndex, fileSignal }: Args): LanguageState {
  const [state, setState] = useState(language.state)
  useEffect(() => language.subscribe(() => setState(language.state)), [language])

  // 1. boot: right after the world worker (they would compete for the network), but not much later if that one is slow
  useEffect(() => {
    if (installedVersion !== null) return void language.ensure(installedVersion)
    const timer = setTimeout(() => void language.ensure(configuredVersion), FALLBACK_BOOT_MS)
    return () => clearTimeout(timer)
  }, [language, installedVersion, configuredVersion])

  // network back after a start without it: the Python part (CDN, PyPI) is loaded now
  useEffect(() => {
    const retry = () => {
      if (language.state.phase === 'error' || (language.state.phase === 'ready' && !language.state.python)) void language.retry()
    }
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [language])

  // 2. the engine's API index (needs the real package, so it comes from the world worker)
  const apiFor = useRef<string | null>(null)
  useEffect(() => {
    if (!installedVersion || !hasApiIndex || apiFor.current === installedVersion) return
    apiFor.current = installedVersion
    void runner.rpc<string>('api').then((reply) => {
      if (reply.ok) {
        language.setApi(reply.value)
        host.current?.relint()
      } else apiFor.current = null
    })
  }, [language, runner, installedVersion, hasApiIndex, host])

  // 3. the project's sources, so jedi can follow imports between files
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const push = () => void readSources(fs, session).then((files) => language.sync(files))
    timer = setTimeout(push, 0)
    const off = session?.subscribeEdits(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(push, SYNC_DELAY_MS)
    })
    return () => {
      off?.()
      if (timer) clearTimeout(timer)
    }
  }, [language, fs, session, fileSignal])

  // 4. the editor uses it
  const assist = useMemo(() => createAssist({ service: language, files: () => readSources(fs, session), lang: getLang }), [language, fs, session])
  useEffect(() => {
    host.current?.setAssist(assist)
    return () => host.current?.setAssist(null)
  }, [assist, host, session])

  // 5. fresh hints when the service becomes ready or learns what the engine offers
  useEffect(() => {
    if (state.phase === 'ready') host.current?.relint()
  }, [state.phase, state.hints, state.ruff, host])

  return state
}

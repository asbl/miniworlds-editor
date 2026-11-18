import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { t } from '../i18n'
import type { Catalog } from '../packages/catalog'
import { ENTRY_DEFAULT } from '../project/manifest'
import { isTextPath } from '../project/search'
import type { ProjectSettings } from '../project/settings'
import type { RunResult, Runner, RuntimeConfig } from '../runtime/runner'
import { errorLocation, type TraceLocation } from '../runtime/traceback'
import type { Fs } from '../workspace'
import { infoDialog } from './dialogs'
import type { EditorHost } from './editorHost'
import { useRunnerState } from './hooks'
import type { Session } from './session'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
/** Wait for the version list, but not for long: offline start must stay quick. */
const catalogReady = (catalog: Catalog) => Promise.race([catalog.load(), sleep(2500)])

export function runtimeConfig(settings: ProjectSettings, catalog: Catalog): RuntimeConfig {
  // Unpinned projects get the newest known version as an exact number, so a worker is reused instead of re-resolving "latest".
  return { miniworlds: settings.miniworlds ?? catalog.data?.latest ?? null, packages: settings.packages }
}

interface Args {
  runner: Runner
  catalog: Catalog
  fs: Fs
  session: Session | null
  host: { current: EditorHost | null }
  settings: ProjectSettings
  settingsLoaded: boolean
  /** `miniworlds` starts the world paused under the ScenarioHost; `program` runs it like a normal program. */
  mode: 'program' | 'miniworlds'
  refresh: () => Promise<void>
}

/** Run/stop a project, show where it failed, write back files the program created. */
export function useProgram({ runner, catalog, fs, session, host, settings, settingsLoaded, mode, refresh }: Args) {
  const state = useRunnerState(runner)
  const [launching, setLaunching] = useState(false)
  const config = useRef<RuntimeConfig>({ miniworlds: null, packages: [] })
  const configKey = JSON.stringify([settings.miniworlds, settings.packages])

  // Warm up Python as soon as the project is open, so that "Run" starts quickly.
  useEffect(() => {
    if (!settingsLoaded) return
    let stale = false
    void catalogReady(catalog).then(() => {
      if (stale || runner.state.phase === 'running' || runner.state.phase === 'stopping') return
      config.current = runtimeConfig(settings, catalog)
      runner.ensureBooted(config.current).catch(() => {}) // the failure is already in the console
    })
    return () => {
      stale = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runner, catalog, settingsLoaded, configKey])

  const jumpTo = useCallback(
    async ({ path, line }: TraceLocation) => {
      if (!session || !(await fs.exists(path))) return
      await session.open(path, { line, column: 0, length: 0 })
      if (isTextPath(path)) host.current?.markError(line)
    },
    [fs, session, host],
  )

  const applyChanges = useCallback(
    async (result: RunResult) => {
      if (!session) return
      for (const path of result.deleted) {
        await fs.remove(path).catch(() => {})
        await session.removed(path)
      }
      for (const [path, buffer] of Object.entries(result.changed)) {
        const bytes = new Uint8Array(buffer)
        if (isTextPath(path)) await session.writeText(path, new TextDecoder().decode(bytes))
        else await fs.write(path, bytes)
      }
      if (result.deleted.length > 0 || Object.keys(result.changed).length > 0) await refresh()
    },
    [fs, session, refresh],
  )

  const run = useCallback(async () => {
    if (!session || launching) return
    setLaunching(true)
    try {
      await session.saveAll()
      host.current?.clearErrors()
      const entry = ENTRY_DEFAULT
      const entries = (await fs.list()).filter((e) => e.kind === 'file')
      if (!entries.some((e) => e.path === entry)) return void (await infoDialog(t('dialog.error'), t('run.noEntry', { entry })))
      const files: Record<string, Uint8Array> = {}
      for (const e of entries) files[e.path] = await fs.readBytes(e.path)
      await catalogReady(catalog)
      config.current = runtimeConfig(settings, catalog)
      const running = runner.run(files, entry, config.current, { scenario: mode === 'miniworlds' })
      runner.canvas.focus()
      const result = await running
      await applyChanges(result)
      if (result.error) {
        const location = errorLocation(result.error)
        if (location) await jumpTo(location)
      }
    } catch (error) {
      if (!(error instanceof Error && error.message === t('run.cancelled'))) {
        await infoDialog(t('dialog.error'), t('run.offline', { version: config.current.miniworlds ?? 'latest' }))
      }
    } finally {
      setLaunching(false)
    }
  }, [session, launching, fs, catalog, settings, runner, host, mode, applyChanges, jumpTo])

  const stop = useCallback(async () => {
    const changes = await runner.stop()
    await applyChanges({ ...changes, error: null, stopped: true })
  }, [runner, applyChanges])

  // "launching" only covers the time until the program is actually running; a running program can be restarted.
  useEffect(() => {
    if (state.phase === 'running') setLaunching(false)
  }, [state.phase])

  const busy = launching || state.phase === 'running' || state.phase === 'stopping'
  return { run, stop, jumpTo, busy, state }
}

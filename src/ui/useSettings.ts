import { useCallback, useEffect, useState } from 'preact/hooks'
import { MANIFEST_FILE, type ProjectKind } from '../project/manifest'
import { DEFAULT_SETTINGS, browserKeyValue, loadSettings, saveSettings, type ProjectSettings } from '../project/settings'
import type { Fs } from '../workspace'
import type { Session } from './session'

const keyValue = browserKeyValue()

/** Per-project runtime settings (pinned engine version, packages): in project.toml, or browser storage for single-file projects. */
export function useSettings(fs: Fs, kind: ProjectKind, projectName: string, session: Session | null) {
  const [settings, setSettings] = useState<ProjectSettings>(DEFAULT_SETTINGS)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (kind === 'empty') return
    let stale = false
    void loadSettings(fs, kind, projectName, keyValue).then((s) => {
      if (stale) return
      setSettings(s)
      setLoaded(true)
    })
    return () => {
      stale = true
    }
  }, [fs, kind, projectName])

  const update = useCallback(
    async (patch: Partial<ProjectSettings>) => {
      const next = { ...settings, ...patch }
      setSettings(next)
      await session?.saveAll() // project.toml may be open with unsaved edits
      await saveSettings(fs, kind, projectName, keyValue, next)
      if (kind === 'project') await session?.reload(MANIFEST_FILE)
    },
    [fs, kind, projectName, session, settings],
  )

  return { settings, loaded, update }
}

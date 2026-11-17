import { useCallback, useState } from 'preact/hooks'

export type ViewMode = 'program' | 'greenfoot'
const key = (project: string) => `miniworlds-editor.mode.${project}`

/** Per-project view choice (plain program or Greenfoot view), remembered in the browser. */
export function useMode(project: string): [ViewMode, (mode: ViewMode) => void] {
  const [mode, setModeState] = useState<ViewMode>(() => {
    try {
      return localStorage.getItem(key(project)) === 'greenfoot' ? 'greenfoot' : 'program'
    } catch {
      return 'program'
    }
  })
  const setMode = useCallback(
    (next: ViewMode) => {
      setModeState(next)
      try {
        localStorage.setItem(key(project), next)
      } catch {
        /* not remembered */
      }
    },
    [project],
  )
  return [mode, setMode]
}

const AUTO_KEY = 'miniworlds-editor.autoreload'
export function useAutoReloadSetting(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(AUTO_KEY) !== 'off'
    } catch {
      return true
    }
  })
  return [
    on,
    (next) => {
      setOn(next)
      try {
        localStorage.setItem(AUTO_KEY, next ? 'on' : 'off')
      } catch {
        /* not remembered */
      }
    },
  ]
}

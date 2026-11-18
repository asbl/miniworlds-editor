import { useCallback, useState } from 'preact/hooks'

export type ViewMode = 'program' | 'miniworlds'
const key = (project: string) => `miniworlds-editor.mode.${project}`

/** Set the remembered view of a project before it is shown (embedding page asks for a view). */
export function rememberMode(project: string, mode: ViewMode): void {
  try {
    localStorage.setItem(key(project), mode)
  } catch {
    /* the project then opens in the view it had */
  }
}

/** Per-project view choice (plain program or Miniworlds view), remembered in the browser. */
export function useMode(project: string): [ViewMode, (mode: ViewMode) => void] {
  const [mode, setModeState] = useState<ViewMode>(() => {
    try {
      const value = localStorage.getItem(key(project)) // 'greenfoot' = value of earlier versions
      return value === 'miniworlds' || value === 'greenfoot' ? 'miniworlds' : 'program'
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

import { useEffect, useState } from 'preact/hooks'

/** Below this width the three columns (files, editor, world) do not fit: one pane at a time. Keep in step with style.css. */
export const NARROW_QUERY = '(max-width: 900px)'

export function useNarrow(query: string = NARROW_QUERY): boolean {
  const [narrow, setNarrow] = useState(() => (typeof matchMedia === 'function' ? matchMedia(query).matches : false))
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const list = matchMedia(query)
    const update = () => setNarrow(list.matches)
    update()
    list.addEventListener('change', update)
    return () => list.removeEventListener('change', update)
  }, [query])
  return narrow
}

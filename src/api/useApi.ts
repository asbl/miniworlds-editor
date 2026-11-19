import { useEffect, useState } from 'preact/hooks'
import type { Runner } from '../runtime/runner'
import { parseIndex, type ApiIndex } from './apiIndex'

const cache = new Map<string, ApiIndex>()

/** The engine's API index for the installed version (fetched from the world's worker once per version). */
export function useApiIndex(runner: Runner, version: string | null, supported: boolean): ApiIndex | null {
  const [index, setIndex] = useState<ApiIndex | null>(version ? (cache.get(version) ?? null) : null)
  useEffect(() => {
    if (!version || !supported) return void setIndex(null)
    const known = cache.get(version)
    if (known) return void setIndex(known)
    let stale = false
    void runner.rpc<string>('api').then((reply) => {
      if (stale || !reply.ok) return
      const parsed = parseIndex(reply.value)
      if (parsed) {
        cache.set(version, parsed)
        setIndex(parsed)
      }
    })
    return () => {
      stale = true
    }
  }, [runner, version, supported])
  return index
}

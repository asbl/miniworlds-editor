import { useEffect, useRef, useState } from 'preact/hooks'
import { isTextPath } from '../project/search'
import type { Runner } from '../runtime/runner'
import type { Session } from '../ui/session'
import type { Fs } from '../workspace'
import { mergeWithPrevious, type ClassModel } from './model'

export type ModelStatus = 'waiting' | 'ready' | 'unsupported' | 'error'

const DELAY_MS = 300

/** Python sources as the user sees them now (unsaved edits included). */
export async function readSources(fs: Fs, session: Session | null): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  for (const e of await fs.list()) {
    if (e.kind !== 'file' || !e.path.endsWith('.py') || !isTextPath(e.path)) continue
    files[e.path] = session ? await session.readText(e.path) : await fs.read(e.path)
  }
  return files
}

/**
 * The live class model: refreshed (debounced) after edits and file changes, as soon as Python is ready.
 * Parsing happens in the interpreter with `ast` only, nothing is run. Needs miniworlds with `class_model` (full tier).
 */
export function useClassModel(opts: { runner: Runner; session: Session | null; fs: Fs; supported: boolean; ready: boolean; fileSignal: unknown }) {
  const { runner, session, fs, supported, ready, fileSignal } = opts
  const [model, setModel] = useState<ClassModel | null>(null)
  const [files, setFiles] = useState<Record<string, string>>({})
  const [status, setStatus] = useState<ModelStatus>('waiting')
  const previous = useRef<ClassModel | null>(null)
  const generation = useRef(0)

  const refresh = useRef<() => void>(() => {})
  refresh.current = async () => {
    const mine = ++generation.current
    if (!supported) return setStatus('unsupported')
    if (!ready) return setStatus('waiting')
    const sources = await readSources(fs, session)
    const reply = await runner.rpc<ClassModel>('model', sources)
    if (mine !== generation.current) return // a newer request is on its way
    if (!reply.ok) return setStatus('error')
    const merged = mergeWithPrevious(previous.current, reply.value)
    previous.current = merged
    setFiles(sources)
    setModel(merged)
    setStatus('ready')
  }

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => void refresh.current(), 0)
    const off = session?.subscribeEdits(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void refresh.current(), DELAY_MS)
    })
    return () => {
      off?.()
      if (timer) clearTimeout(timer)
    }
  }, [session, supported, ready, fileSignal])

  return { model, files, status, refresh: () => void refresh.current() }
}

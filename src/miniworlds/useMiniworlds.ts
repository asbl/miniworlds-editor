import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { t } from '../i18n'
import type { Runner } from '../runtime/runner'
import { openDialog } from '../ui/dialogs'
import { useRunnerState } from '../ui/hooks'
import type { Fs } from '../workspace'
import { MiniworldsController, type MiniworldsEnv, type MiniworldsState } from './controller'
import { emptyMeta, loadMeta, saveMeta, type MiniworldsMeta } from './meta'
import { ScenarioClient } from './scenario'

const SAVE_DELAY_MS = 300
const POLL_MS = 300

/** miniworlds.json of the open project: loaded once, saved shortly after every change. */
export function useMiniworldsMeta(fs: Fs, onFileCreated: () => void) {
  const ref = useRef<MiniworldsMeta>(emptyMeta())
  const [meta, setMetaState] = useState<MiniworldsMeta>(ref.current)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirty = useRef(false)

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (!dirty.current) return
    dirty.current = false
    const before = (await fs.list()).map((e) => e.path).join()
    await saveMeta(fs, ref.current)
    if (before !== (await fs.list()).map((e) => e.path).join()) onFileCreated()
  }, [fs, onFileCreated])

  useEffect(() => {
    let stale = false
    void loadMeta(fs).then((m) => {
      if (stale) return
      ref.current = m
      setMetaState(m)
    })
    // best effort when the page goes away (reload, tab closed) inside the save delay
    const onHide = () => void flush()
    window.addEventListener('pagehide', onHide)
    return () => {
      stale = true
      window.removeEventListener('pagehide', onHide)
      void flush()
    }
  }, [fs, flush])

  const setMeta = useCallback(
    (next: MiniworldsMeta) => {
      ref.current = next
      dirty.current = true
      setMetaState(next)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS)
    },
    [flush],
  )

  return { meta, metaRef: ref, setMeta, flush }
}

/** Dialog that asks for constructor or method arguments (texts, parsed by the engine with literal_eval only). */
const askValues: MiniworldsEnv['ui']['askValues'] = async ({ title, params, submit, validate }) => {
  const values = await openDialog({
    title,
    message: t('miniworlds.ctor.hint'),
    submit: submit === 'call' ? 'miniworlds.call' : 'dialog.create',
    fields: params.map((p, i) => ({
      kind: 'text' as const,
      key: `p${i}`,
      label: p.name + (p.required ? ' *' : ''),
      placeholder: p.required ? t('miniworlds.value') : t('miniworlds.default', { value: p.default ?? '' }),
    })),
    validate: async (v) => {
      const texts = params.map((_, i) => String(v[`p${i}`] ?? ''))
      const missing = params.find((p, i) => p.required && texts[i]?.trim() === '')
      if (missing) return t('miniworlds.missing', { name: missing.name })
      return validate ? validate(texts) : null
    },
  })
  return values ? params.map((_, i) => String(values[`p${i}`] ?? '')) : null
}

/** One controller per runner; follows the scenario's life (ready → active, ended → reset) and polls its status. */
export function useMiniworlds(runner: Runner, metaApi: ReturnType<typeof useMiniworldsMeta>) {
  const runnerState = useRunnerState(runner)
  const metaApiRef = useRef(metaApi)
  metaApiRef.current = metaApi

  const controller = useMemo(() => {
    const env: MiniworldsEnv = {
      getMeta: () => metaApiRef.current.metaRef.current,
      setMeta: (m) => metaApiRef.current.setMeta(m),
      note: (text, kind) => runner.note(text, kind),
      ui: { askValues },
      text: (key, params) => t(`miniworlds.${key}` as 'miniworlds.replayed', params),
    }
    return new MiniworldsController(new ScenarioClient(runner), env)
  }, [runner])

  const [state, setState] = useState<MiniworldsState>(controller.state)
  useEffect(() => {
    setState(controller.state)
    return controller.subscribe(() => setState(controller.state))
  }, [controller])

  const ready = runnerState.mode === 'scenario' && runnerState.scenarioReady
  useEffect(() => {
    if (ready) void controller.onReady()
    else controller.onEnded()
  }, [ready, controller])

  useEffect(() => {
    if (!state.active) return
    const id = setInterval(() => void controller.poll(), POLL_MS)
    return () => clearInterval(id)
  }, [state.active, controller])

  return { controller, state, runnerState }
}

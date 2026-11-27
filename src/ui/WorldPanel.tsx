import { closeExperimentHint, isExperimentHintClosed } from './experimentHint'
import { useEffect, useId, useRef, useState } from 'preact/hooks'
import { t, useLang } from '../i18n'
import type { MiniworldsController, MiniworldsState } from '../miniworlds/controller'
import { MiniworldsControls } from '../miniworlds/MiniworldsPanel'
import { attachWorldTools, type WorldPoint } from '../miniworlds/worldTools'
import { GuidesOverlay } from '../miniworlds/GuidesOverlay'
import { anyGuides, loadGuides, saveGuides, type Guides } from '../miniworlds/guides'
import { Inspector } from '../miniworlds/Inspector'
import { TracePanel } from '../trace/TracePanel'
import type { TraceView } from '../trace/useTrace'
import { attachInput, canvasPoint } from '../runtime/input'
import type { Runner } from '../runtime/runner'
import type { TraceLocation } from '../runtime/traceback'
import { BootPlaceholder } from './BootPlaceholder'
import type { RemoteConsole } from '../collab/useShareRun'
import { Console } from './Console'
import { openContextMenu } from './ContextMenu'
import { infoDialog } from './dialogs'
import { useRunnerState } from './hooks'
import { Menu } from './Menu'
import type { ViewMode } from './useMode'
import { rememberMuted } from '../runtime/browser'
import { openWorldWindow, type WorldWindow, type WorldWindowKind } from './worldWindow'

export interface MiniworldsProps {
  controller: MiniworldsController
  state: MiniworldsState
  onReset: () => void
  onInsert: (code: string) => void
}

/** Right-hand panel: the world's canvas (lives in the worker), Miniworlds controls when in that view, and the console. */
export interface TasksProps {
  items: string[]
  done: Record<string, boolean>
  onToggle: (index: number) => void
  /** The task is ticked automatically when the work is done. */
  hasCheck?: (index: number) => boolean
  /** Graded tips for a task that is not done yet: the first says where to look, the next what to type. */
  tips?: (index: number) => string[]
  /** The tasks are the editor's own ideas for this program. */
  ideas?: boolean
}

/** The output of the other people's programs (working together): shown in the console, one source at a time. */
export interface RemoteConsoles {
  runs: RemoteConsole[]
  /** The person whose output to show as soon as they start a program (followed, or driving). */
  preferred: number | null
  onSeen: (id: number) => void
  onClear: (id: number) => void
}

/** "Tip" under an open task: one tip at a time, the next on request; nothing when there is none. */
function TaskTip({ tips, n }: { tips: string[]; n: number }) {
  const [shown, setShown] = useState(0)
  if (tips.length === 0) return null
  const visible = Math.min(shown, tips.length)
  return (
    <div class="task-tip">
      {tips.slice(0, visible).map((tip, k) => (
        <p key={k} class="task-tip-text small" role="note" aria-label={t('tasks.tipLabel', { n })}>
          <span aria-hidden="true">💡 </span>
          {tip}
        </p>
      ))}
      {visible < tips.length ? (
        <button type="button" class="link-button small" aria-label={`${visible === 0 ? t('tasks.tip') : t('tasks.tipMore')} (${n})`} onClick={() => setShown(visible + 1)}>
          {visible === 0 ? t('tasks.tip') : t('tasks.tipMore')}
        </button>
      ) : (
        <button type="button" class="link-button small" aria-label={`${t('tasks.tipHide')} (${n})`} onClick={() => setShown(0)}>
          {t('tasks.tipHide')}
        </button>
      )}
    </div>
  )
}

interface WorldPanelProps {
  runner: Runner
  visible: boolean
  onJump: (location: TraceLocation) => void
  onReport?: () => void
  miniworlds?: MiniworldsProps
  tasks?: TasksProps
  trace?: TraceView
  remote?: RemoteConsoles
  name?: string
  onTryExperiment?: () => void
  mode: {
    view: ViewMode
    supported: boolean
    onChange: (view: ViewMode) => void
    autoReload: boolean
    onAutoReload: (on: boolean) => void
  }
}

/** The docked world, its controls and the output and tasks below it. */
export function WorldPanel({ runner, visible, onJump, onReport, miniworlds, tasks, trace, remote, name = '', onTryExperiment, mode }: WorldPanelProps) {
  useLang()
  const state = useRunnerState(runner)
  const slot = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const controller = miniworlds?.controller
  // where the world is shown: in this panel, full screen, or in a window/tab of its own
  const [popup, setPopup] = useState<WorldWindow | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [tick, redraw] = useState(0)
  const [guides, setGuides] = useState<Guides>(loadGuides)
  const [hintClosed, setHintClosed] = useState(isExperimentHintClosed)
  const [mouse, setMouse] = useState<WorldPoint | null>(null)
  const docked = !popup && !fullscreen
  const tasksId = useId()
  const hasTasks = !!tasks?.items.length
  const [drawer, setDrawer] = useState<'tasks' | 'console' | 'closed' | null>(null)
  const activeDrawer = state.input ? 'console' : drawer ?? (hasTasks && !tasks?.ideas ? 'tasks' : 'closed')
  const consoleOpen = activeDrawer === 'console'
  const tasksOpen = hasTasks && activeDrawer === 'tasks'
  const [watching, setWatching] = useState<number | null>(null)
  const selectedRun = remote?.runs.find((run) => run.id === watching)
  const watched = state.input ? undefined : selectedRun
  const preferred = remote?.runs.find((run) => run.id === remote.preferred)
  const lastOutput = state.lines.findLast((line) => line.kind !== 'system')
  const lastError = state.lines.findLast((line) => line.kind === 'stderr')

  useEffect(() => {
    if (state.phase === 'running') setWatching(null)
  }, [state.phase])
  useEffect(() => {
    if (preferred && preferred.running) {
      setWatching(preferred.id)
      setDrawer('console')
    }
  }, [preferred?.id, preferred?.started])
  useEffect(() => {
    if (lastOutput) setDrawer((current) => current === 'tasks' ? current : 'console')
  }, [lastOutput?.id])
  useEffect(() => {
    if (!lastError && !state.input) return
    setDrawer('console')
    setWatching(null)
  }, [lastError?.id, state.input?.id])
  useEffect(() => {
    if (watching !== null && !selectedRun) setWatching(null)
    if (consoleOpen && watched && watched.unseen > 0) remote?.onSeen(watched.id)
  }, [watching, selectedRun?.id, consoleOpen, watched?.id, watched?.unseen, watched?.lines.length])

  // The canvas element is replaced with every new worker (it can be handed over only once): mount the current one.
  useEffect(() => {
    const canvas = runner.canvas
    canvas.setAttribute('aria-label', t('run.canvasLabel'))
    const target = popup ?? null
    if (target) {
      target.stage.replaceChildren(canvas)
      target.setRatio(canvas.width, canvas.height)
    } else {
      slot.current?.replaceChildren(canvas)
    }
    // the editor's own tools (place, select, drag, menus) work only in the panel; elsewhere the mouse belongs to the program
    const detachInput = attachInput(canvas, (event) => runner.sendInput(event), () => !docked || !controller?.interactive)
    const detachTools = controller && docked ? attachWorldTools(canvas, controller, (e, p) => void showMenu(e, p)) : () => {}
    return () => {
      detachInput()
      detachTools()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runner, state.canvasGeneration, controller, popup, docked])

  // keep a window's proportions in step with the program's canvas
  useEffect(() => popup?.setRatio(runner.canvas.width, runner.canvas.height))

  // the displayed size changes with the window, with full screen and with the sidebar: the selection frame follows
  useEffect(() => {
    const canvas = runner.canvas
    if (typeof ResizeObserver !== 'function' || popup) return
    const watch = new ResizeObserver(() => redraw((n) => n + 1))
    watch.observe(canvas)
    return () => watch.disconnect()
  }, [runner, state.canvasGeneration, popup])

  useEffect(() => {
    const change = () => setFullscreen(document.fullscreenElement !== null && document.fullscreenElement === stage.current)
    document.addEventListener('fullscreenchange', change)
    return () => document.removeEventListener('fullscreenchange', change)
  }, [])

  // guide lines: remembered, and the controller fetches every actor only while directions or boxes are shown
  const needsActors = guides.direction || guides.boxes
  useEffect(() => {
    saveGuides(guides)
    controller?.setGuides(needsActors)
  }, [guides, controller, needsActors])

  // the mouse position in world pixels, shown next to the grid
  useEffect(() => {
    const canvas = runner.canvas
    if (!guides.coords || !docked) return void setMouse(null)
    const move = (e: PointerEvent) => setMouse(canvasPoint(e, canvas.getBoundingClientRect(), canvas))
    const leave = () => setMouse(null)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerleave', leave)
    return () => {
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerleave', leave)
    }
  }, [runner, state.canvasGeneration, guides.coords, docked])

  // a window of its own: notice when it is closed (the canvas then comes back), and close it with this page
  useEffect(() => {
    if (!popup) return
    const closed = () => setPopup(null)
    const timer = setInterval(() => popup.win.closed && closed(), 400)
    popup.win.addEventListener('pagehide', closed)
    window.addEventListener('pagehide', popup.close)
    return () => {
      clearInterval(timer)
      try {
        popup.win.removeEventListener('pagehide', closed)
      } catch {
        /* window already gone */
      }
      window.removeEventListener('pagehide', popup.close)
    }
  }, [popup])

  async function show(where: 'docked' | 'fullscreen' | WorldWindowKind) {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})
    if (popup) {
      popup.close()
      setPopup(null)
    }
    if (where === 'docked') return
    if (where === 'fullscreen') {
      try {
        await stage.current?.requestFullscreen()
      } catch {
        await infoDialog(t('world.show'), t('world.fullscreenBlocked'))
      }
      return
    }
    const next = openWorldWindow(where, runner.canvas, t('world.pageTitle', { name }))
    if (!next) return void (await infoDialog(t('world.show'), t('world.blocked')))
    setPopup(next)
    next.win.focus()
  }

  async function showMenu(event: MouseEvent, point: WorldPoint) {
    if (!controller) return
    const actor = await controller.pickAt(point.x, point.y)
    if (actor) {
      await controller.select(actor.handle)
      const methods = await controller.methodsOf(actor.handle)
      openContextMenu(event.clientX, event.clientY, [
        { header: actor.cls },
        ...methods.map((m) => ({ text: `${m.name}(${m.params.map((p) => p.name).join(', ')})`, run: () => void controller.invokeMethod(actor.handle, m) })),
        '-',
        { text: t('miniworlds.menu.delete'), danger: true, run: () => void controller.removeActor(actor.handle) },
      ])
    } else {
      await controller.select(null)
      const classes = controller.state.classes.filter((c) => c.is_actor)
      openContextMenu(event.clientX, event.clientY, [
        { header: t('miniworlds.menu.here') },
        ...classes.map((c) => ({ text: t('miniworlds.menu.new', { cls: c.name }), run: () => void controller.createAt(c.name, point.x, point.y) })),
        ...(classes.length === 0 ? [{ header: t('miniworlds.menu.noClasses') }] : []),
      ])
    }
  }

  const bootText = state.phase === 'booting' ? t(`run.boot.${state.bootStep ?? 'pyodide'}` as const) : null
  const sel = docked ? miniworlds?.state.selected : null
  const canvas = runner.canvas
  const scale = canvas.width > 0 ? canvas.getBoundingClientRect().width / canvas.width : 1
  const mw = miniworlds?.state
  async function saveSnapshot() {
    const png = await runner.snapshot()
    if (!png) return void infoDialog(t('dialog.error'), t('world.snapshotFailed'))
    const url = URL.createObjectURL(new Blob([png], { type: 'image/png' }))
    const link = Object.assign(document.createElement('a'), { href: url, download: `${name || 'welt'}.png` })
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
  const placeItems = [
    { label: t('world.dock'), checked: docked, onSelect: () => void show('docked') },
    { label: t('world.fullscreen'), checked: fullscreen, onSelect: () => void show('fullscreen') },
    { label: t('world.window'), checked: popup?.kind === 'window', onSelect: () => void show('window') },
    { label: t('world.tab'), checked: popup?.kind === 'tab', onSelect: () => void show('tab') },
    { label: t('guides.coords'), divider: true, toggle: true, checked: guides.coords, onSelect: () => setGuides({ ...guides, coords: !guides.coords }) },
    ...(state.phase === 'running' ? [{ label: t('world.snapshot'), divider: true, onSelect: () => void saveSnapshot() }] : []),
    ...(controller
      ? [
          { label: t('guides.direction'), toggle: true, checked: guides.direction, onSelect: () => setGuides({ ...guides, direction: !guides.direction }) },
          { label: t('guides.boxes'), toggle: true, checked: guides.boxes, onSelect: () => setGuides({ ...guides, boxes: !guides.boxes }) },
        ]
      : []),
  ]

  return (
    <section class={mw?.armed ? 'world-panel armed' : 'world-panel'} aria-label={t('a11y.world')}>
      <div class="world-mode">
        <span class="mode-label" aria-hidden="true">{t('mode.label')}</span>
        <div class="segmented mode-switch" role="group" aria-label={t('mode.label')}>
          <button type="button" aria-pressed={mode.view === 'program'} title={t('mode.programHint')} onClick={() => mode.onChange('program')}>
            {t('mode.program')}
          </button>
          <button
            type="button"
            aria-pressed={mode.view === 'miniworlds'}
            disabled={!mode.supported}
            title={t(mode.supported ? 'mode.miniworldsHint' : 'mode.needsFull')}
            onClick={() => mode.onChange('miniworlds')}
          >
            {t('mode.miniworlds')}
          </button>
        </div>
        {mode.view === 'miniworlds' && (
          <label class="inline small">
            <input type="checkbox" checked={mode.autoReload} onChange={(e) => mode.onAutoReload(e.currentTarget.checked)} />
            <span>{t('miniworlds.autoReload')}</span>
          </label>
        )}
      </div>
      <div class="world-head">
        <div class="world-status" role="status">
          {bootText ?? t(`run.state.${state.phase === 'booting' ? 'idle' : state.phase}` as const)}
          {mw && !bootText && (
            <span class="mw-info muted">
              {' · '}
              {mw.active ? `${t('miniworlds.frame', { n: mw.frame })} · ${t('miniworlds.actors', { n: mw.actors })}` : t('miniworlds.starting')}
            </span>
          )}
          {state.version && !mw && <span class="muted"> · miniworlds {state.version}</span>}
          {mouse && <span class="mw-info muted mouse-pos"> · x {mouse.x}, y {mouse.y}</span>}
        </div>
        {state.audioUsed && runner.audio?.setMuted && (
          <button
            type="button"
            class="menu-button"
            aria-pressed={runner.audio.isMuted}
            title={t(runner.audio.isMuted ? 'world.unmute' : 'world.mute')}
            aria-label={t(runner.audio.isMuted ? 'world.unmute' : 'world.mute')}
            onClick={() => {
              const next = !runner.audio?.isMuted
              runner.audio?.setMuted?.(next)
              rememberMuted(next)
              redraw((n) => n + 1)
            }}
          >
            {runner.audio.isMuted ? '🔇' : '🔊'}
          </button>
        )}
        <Menu label="⤢" title={t('world.view')} items={placeItems} align="right" />
      </div>
      <div
        class={popup ? 'world-stage popped' : 'world-stage'}
        ref={stage}
        style={{ '--ar': state.canvasSize.width / state.canvasSize.height }}
      >
        <div class="world-wrap" hidden={popup !== null}>
          <div ref={slot} />
          {state.phase === 'booting' && docked && <BootPlaceholder step={state.bootStep} />}
          {docked && anyGuides(guides) && <GuidesOverlay canvas={runner.canvas} guides={guides} actors={mw?.actorList ?? []} tick={tick} />}
          {sel && (
            <div
              class="selection-box"
              style={{
                left: `${(sel.x - sel.size[0] / 2) * scale}px`,
                top: `${(sel.y - sel.size[1] / 2) * scale}px`,
                width: `${sel.size[0] * scale}px`,
                height: `${sel.size[1] * scale}px`,
              }}
            />
          )}
        </div>
        {popup && (
          <div class="world-popped">
            <p>{t('world.popped')}</p>
            <button type="button" onClick={() => void show('docked')}>
              {t('world.bringBack')}
            </button>
          </div>
        )}
      </div>
      {miniworlds && <MiniworldsControls {...miniworlds} />}
      {!miniworlds && onTryExperiment && !hintClosed && state.phase !== 'running' && state.phase !== 'stopping' && (
        <div class="experiment-hint" role="note">
          <strong>{t('experiment.title')}</strong>
          <span>{t('experiment.text')}</span>
          <button type="button" class="primary" onClick={onTryExperiment}>{t('experiment.start')}</button>
          <button type="button" onClick={() => { closeExperimentHint(); setHintClosed(true) }}>{t('experiment.close')}</button>
        </div>
      )}
      {mw?.selected && <Inspector actor={mw.selected} inspection={mw.inspection} onClose={() => void controller?.select(null)} />}
      {trace && <TracePanel trace={trace} running={state.phase === 'running'} onJump={onJump} />}
      <div class="world-drawer">
        <Console
          lines={watched?.lines ?? state.lines}
          onClear={() => watched ? remote?.onClear(watched.id) : runner.clearConsole()}
          onJump={onJump}
          waiting={visible ? state.input : null}
          onAnswer={(text) => runner.answerInput(text)}
          onReport={watched ? undefined : onReport}
          disclosure={{ open: consoleOpen, toggle: () => setDrawer(consoleOpen ? 'closed' : 'console') }}
          beforeToggle={hasTasks && tasks && (
            <button type="button" class="tasks-toggle" aria-expanded={tasksOpen} aria-controls={tasksId} disabled={!!state.input} onClick={() => setDrawer(tasksOpen ? 'closed' : 'tasks')}>
              <span aria-hidden="true">{tasksOpen ? '▾' : '▸'}</span>{' '}
              {t(tasks.ideas ? 'tasks.ideas' : 'tasks.title', { done: tasks.items.filter((_, i) => tasks.done[i]).length, total: tasks.items.length })}
            </button>
          )}
          sources={remote && remote.runs.length > 0 && (
            <div class="console-sources" role="tablist" aria-label={t('collab.console.sources')}>
              <button type="button" role="tab" aria-selected={watched === undefined} onClick={() => setWatching(null)}>
                {t('collab.console.mine')}
              </button>
              {remote.runs.map((run) => (
                <button key={run.id} type="button" role="tab" aria-selected={watched?.id === run.id} disabled={!!state.input} onClick={() => setWatching(run.id)}>
                  <span class="collab-dot" style={{ background: run.color }} aria-hidden="true" /> {run.name}
                  {run.running ? <span class="console-live" title={t('collab.console.running')}> ●</span> : run.unseen > 0 && watched?.id !== run.id ? ' •' : ''}
                </button>
              ))}
            </div>
          )}
        />
        {hasTasks && tasks && (
          <div class="tasks" id={tasksId} hidden={!tasksOpen}>
            <ol>
              {tasks.items.map((text, i) => (
                <li key={i}>
                  <label>
                    <input type="checkbox" checked={!!tasks.done[i]} aria-label={t('tasks.itemDone', { n: i + 1 })} onChange={() => tasks.onToggle(i)} />
                    <span> {text}</span>
                    {tasks.hasCheck?.(i) && (
                      <span class="auto-check" title={t('tasks.auto')} aria-label={t('tasks.auto')}>
                        {' '}
                        ✦
                      </span>
                    )}
                  </label>
                  <TaskTip tips={tasks.tips?.(i) ?? []} n={i + 1} />
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  )
}

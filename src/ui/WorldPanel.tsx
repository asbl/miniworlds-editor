import { useEffect, useRef, useState } from 'preact/hooks'
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
}

/** The output of the other people's programs (working together): shown in the console, one source at a time. */
export interface RemoteConsoles {
  runs: RemoteConsole[]
  /** The person whose output to show as soon as they start a program (followed, or driving). */
  preferred: number | null
  onSeen: (id: number) => void
  onClear: (id: number) => void
}

export function WorldPanel({ runner, onJump, onReport, miniworlds, tasks, trace, remote, name = '' }: { runner: Runner; onJump: (location: TraceLocation) => void; onReport?: () => void; miniworlds?: MiniworldsProps; tasks?: TasksProps; trace?: TraceView; remote?: RemoteConsoles; name?: string }) {
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
  const [mouse, setMouse] = useState<WorldPoint | null>(null)
  const docked = !popup && !fullscreen
  // whose output the console shows: null is this person's own
  const [watching, setWatching] = useState<number | null>(null)
  const watched = watching === null ? undefined : remote?.runs.find((r) => r.id === watching)
  const preferred = remote?.runs.find((r) => r.id === remote.preferred)
  useEffect(() => {
    if (state.phase === 'running') setWatching(null) // one's own program: one's own output
  }, [state.phase])
  useEffect(() => {
    if (preferred && preferred.running) setWatching(preferred.id)
  }, [preferred?.id, preferred?.started])
  useEffect(() => {
    if (watching !== null && !watched) setWatching(null) // the person left
    else if (watched && watched.unseen > 0) remote?.onSeen(watched.id)
  }, [watching, watched?.unseen, watched?.lines.length])

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
  const placeItems = [
    { label: t('world.dock'), checked: docked, onSelect: () => void show('docked') },
    { label: t('world.fullscreen'), checked: fullscreen, onSelect: () => void show('fullscreen') },
    { label: t('world.window'), checked: popup?.kind === 'window', onSelect: () => void show('window') },
    { label: t('world.tab'), checked: popup?.kind === 'tab', onSelect: () => void show('tab') },
    { label: t('guides.coords'), divider: true, toggle: true, checked: guides.coords, onSelect: () => setGuides({ ...guides, coords: !guides.coords }) },
    ...(controller
      ? [
          { label: t('guides.direction'), toggle: true, checked: guides.direction, onSelect: () => setGuides({ ...guides, direction: !guides.direction }) },
          { label: t('guides.boxes'), toggle: true, checked: guides.boxes, onSelect: () => setGuides({ ...guides, boxes: !guides.boxes }) },
        ]
      : []),
  ]

  return (
    <section class={mw?.armed ? 'world-panel armed' : 'world-panel'} aria-label={t('a11y.world')}>
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
      <div class="world-stage" ref={stage}>
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
      {mw?.selected && <Inspector actor={mw.selected} inspection={mw.inspection} onClose={() => void controller?.select(null)} />}
      {trace && <TracePanel trace={trace} running={state.phase === 'running'} onJump={onJump} />}
      {tasks && tasks.items.length > 0 && (
        <details class="tasks" open>
          <summary>{t('tasks.title', { done: tasks.items.filter((_, i) => tasks.done[i]).length, total: tasks.items.length })}</summary>
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
              </li>
            ))}
          </ol>
        </details>
      )}
      {remote && remote.runs.length > 0 && (
        <div class="console-sources" role="tablist" aria-label={t('collab.console.sources')}>
          <button type="button" role="tab" aria-selected={watched === undefined} onClick={() => setWatching(null)}>
            {t('collab.console.mine')}
          </button>
          {remote.runs.map((run) => (
            <button key={run.id} type="button" role="tab" aria-selected={watched?.id === run.id} onClick={() => setWatching(run.id)}>
              <span class="collab-dot" style={{ background: run.color }} aria-hidden="true" /> {run.name}
              {run.running ? <span class="console-live" title={t('collab.console.running')}> ●</span> : run.unseen > 0 && watched?.id !== run.id ? ' •' : ''}
            </button>
          ))}
        </div>
      )}
      {watched ? (
        <Console lines={watched.lines} onClear={() => remote?.onClear(watched.id)} onJump={onJump} />
      ) : (
        <Console lines={state.lines} onClear={() => runner.clearConsole()} onJump={onJump} waiting={state.input} onAnswer={(text) => runner.answerInput(text)} onReport={onReport} />
      )}
    </section>
  )
}

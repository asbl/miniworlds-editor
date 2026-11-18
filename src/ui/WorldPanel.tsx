import { useEffect, useRef } from 'preact/hooks'
import { t, useLang } from '../i18n'
import type { MiniworldsController, MiniworldsState } from '../miniworlds/controller'
import { MiniworldsControls } from '../miniworlds/MiniworldsPanel'
import { attachWorldTools, type WorldPoint } from '../miniworlds/worldTools'
import type { ActorInfo } from '../miniworlds/scenario'
import { attachInput } from '../runtime/input'
import type { Runner } from '../runtime/runner'
import type { TraceLocation } from '../runtime/traceback'
import { Console } from './Console'
import { openContextMenu } from './ContextMenu'
import { openDialog } from './dialogs'
import { useRunnerState } from './hooks'

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
}

export function WorldPanel({ runner, onJump, miniworlds, tasks }: { runner: Runner; onJump: (location: TraceLocation) => void; miniworlds?: MiniworldsProps; tasks?: TasksProps }) {
  useLang()
  const state = useRunnerState(runner)
  const slot = useRef<HTMLDivElement>(null)
  const controller = miniworlds?.controller

  // The canvas element is replaced with every new worker (it can be handed over only once): mount the current one.
  useEffect(() => {
    const canvas = runner.canvas
    canvas.setAttribute('aria-label', t('run.canvasLabel'))
    slot.current?.replaceChildren(canvas)
    const detachInput = attachInput(canvas, (event) => runner.sendInput(event), () => !controller?.interactive)
    const detachTools = controller ? attachWorldTools(canvas, controller, (e, p) => void showMenu(e, p)) : () => {}
    return () => {
      detachInput()
      detachTools()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runner, state.canvasGeneration, controller])

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
        { text: t('miniworlds.menu.inspect'), run: () => void inspect(actor) },
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

  async function inspect(actor: ActorInfo) {
    const data = await controller?.inspect(actor.handle)
    if (!data) return
    const table = (rows: Record<string, string>) => (
      <table class="inspect">
        <tbody>
          {Object.entries(rows).map(([k, v]) => (
            <tr key={k}>
              <th>{k}</th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
    await openDialog({
      title: data.cls,
      info: true,
      body: (
        <>
          {Object.keys(data.fields).length > 0 ? table(data.fields) : <p class="muted">{t('miniworlds.inspect.noFields')}</p>}
          <details>
            <summary>{t('miniworlds.inspect.engine')}</summary>
            {table(data.engine)}
          </details>
        </>
      ),
    })
  }

  const bootText = state.phase === 'booting' ? t(`run.boot.${state.bootStep ?? 'pyodide'}` as const) : null
  const sel = miniworlds?.state.selected
  const canvas = runner.canvas
  const scale = canvas.width > 0 ? canvas.getBoundingClientRect().width / canvas.width : 1

  return (
    <aside class={miniworlds?.state.armed ? 'world-panel armed' : 'world-panel'}>
      <div class="world-stage">
        <div class="world-wrap">
          <div ref={slot} />
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
      </div>
      <div class="world-status" role="status">
        {bootText ?? t(`run.state.${state.phase === 'booting' ? 'idle' : state.phase}` as const)}
        {state.version && <span class="muted"> · miniworlds {state.version}</span>}
      </div>
      {miniworlds && <MiniworldsControls {...miniworlds} />}
      {tasks && tasks.items.length > 0 && (
        <details class="tasks" open>
          <summary>{t('tasks.title', { done: tasks.items.filter((_, i) => tasks.done[i]).length, total: tasks.items.length })}</summary>
          <ol>
            {tasks.items.map((text, i) => (
              <li key={i}>
                <label>
                  <input type="checkbox" checked={!!tasks.done[i]} aria-label={t('tasks.itemDone', { n: i + 1 })} onChange={() => tasks.onToggle(i)} />
                  <span> {text}</span>
                </label>
              </li>
            ))}
          </ol>
        </details>
      )}
      <Console lines={state.lines} onClear={() => runner.clearConsole()} onJump={onJump} />
    </aside>
  )
}

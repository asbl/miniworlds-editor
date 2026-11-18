import { t, useLang } from '../i18n'
import { infoDialog, openDialog } from '../ui/dialogs'
import { Menu, type MenuItem } from '../ui/Menu'
import type { MiniworldsController, MiniworldsState } from './controller'
import { SPEED_MAX, SPEED_MIN, speedLabel } from './scenario'

interface Props {
  controller: MiniworldsController
  state: MiniworldsState
  /** Restart the program (stop, then start again with the remembered start setup). */
  onReset: () => void
  /** Insert generated code at the editor's cursor. */
  onInsert: (code: string) => void
}

/** Controls under the world: Act / Run / Pause, Reset, speed, creating actors; start setup and "save the world" sit in the More menu. */
export function MiniworldsControls({ controller, state, onReset, onInsert }: Props) {
  useLang()
  const actorClasses = state.classes.filter((c) => c.is_actor)
  const steps = controller.setupSteps

  async function saveWorld() {
    let code = ''
    try {
      code = (await controller.exportCode()) || t('miniworlds.export.empty')
    } catch (error) {
      return void (await infoDialog(t('dialog.error'), error instanceof Error ? error.message : String(error)))
    }
    await openDialog({
      title: t('miniworlds.export.title'),
      message: t('miniworlds.export.hint'),
      body: <pre class="export-code">{code}</pre>,
      info: true,
      extra: [
        { label: t('miniworlds.export.copy'), onClick: () => void navigator.clipboard?.writeText(code) },
        { label: t('miniworlds.export.insert'), onClick: () => onInsert(code + '\n'), close: true },
      ],
    })
  }

  const setupItems: MenuItem[] = [
    { label: steps > 0 ? t('miniworlds.startSteps', { n: steps }) : t('miniworlds.startEmpty'), disabled: true, onSelect: () => {} },
    { label: t('miniworlds.keep'), disabled: !state.active || !state.paused, onSelect: () => void controller.keepSetup() },
    { label: t('miniworlds.clear'), disabled: steps === 0, onSelect: () => (controller.clearSetup(), onReset()) },
    { label: t('miniworlds.saveWorld'), divider: true, disabled: !state.active, onSelect: () => void saveWorld() },
  ]

  return (
    <div class="gf">
      <div class="mw-controls">
        <button type="button" disabled={!state.active || !state.paused} onClick={() => void controller.act()}>
          {t('miniworlds.act')}
        </button>
        <button type="button" disabled={!state.active} class="primary-ish" onClick={() => void controller.togglePause()}>
          {state.paused ? `▶ ${t('miniworlds.run')}` : `❚❚ ${t('miniworlds.pause')}`}
        </button>
        <button type="button" onClick={onReset} disabled={!state.active} title={t('miniworlds.reset')}>
          ↻ {t('miniworlds.reset')}
        </button>
        <label class="mw-speed">
          <span>{t('miniworlds.speed')}</span>
          <input
            type="range"
            min={SPEED_MIN}
            max={SPEED_MAX}
            step={1}
            value={state.speedIndex}
            disabled={!state.active}
            aria-valuetext={speedLabel(state.speedIndex)}
            onInput={(e) => void controller.setSpeedIndex(Number(e.currentTarget.value))}
          />
          <output>{speedLabel(state.speedIndex)}</output>
        </label>
        <Menu label={`${t('miniworlds.more')} ▾`} title={t('miniworlds.moreTitle')} items={setupItems} align="right" />
      </div>

      {actorClasses.length > 0 && (
        <div class="mw-add" role="group" aria-label={t('miniworlds.classes')}>
          <span class="mw-label">{t('miniworlds.classes')}</span>
          <div class="mw-class-buttons">
            {actorClasses.map((c) => (
              <button
                type="button"
                key={c.name}
                aria-pressed={state.armed?.cls === c.name}
                title={t('miniworlds.newTitle', { cls: c.name })}
                disabled={!state.active}
                onClick={() => void controller.arm(state.armed?.cls === c.name ? null : c.name)}
              >
                {t('miniworlds.new', { cls: c.name })}
                {state.byClass[c.name] ? <span class="count"> {state.byClass[c.name]}×</span> : null}
              </button>
            ))}
          </div>
        </div>
      )}
      {state.armed && <div class="mw-armed">{t('miniworlds.armed', { cls: state.armed.cls })}</div>}
      {state.lateEdit && <div class="mw-note small muted mw-setup">{t('miniworlds.lateEdit')}</div>}
    </div>
  )
}

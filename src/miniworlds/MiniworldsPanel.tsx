import { t, useLang } from '../i18n'
import { infoDialog, openDialog } from '../ui/dialogs'
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

/** Controls under the world: Act / Run / Pause, speed, Reset, creating actors, start setup, "save the world". */
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

  return (
    <div class="gf">
      <div class="mw-controls">
        <button type="button" disabled={!state.active || !state.paused} onClick={() => void controller.act()}>
          {t('miniworlds.act')}
        </button>
        <button type="button" disabled={!state.active} class="primary-ish" onClick={() => void controller.togglePause()}>
          {state.paused ? `▶ ${t('miniworlds.run')}` : `❚❚ ${t('miniworlds.pause')}`}
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
        <button type="button" onClick={onReset} disabled={!state.active}>
          ↻ {t('miniworlds.reset')}
        </button>
      </div>

      <div class="mw-info" role="status">
        {state.active ? (
          <>
            {t('miniworlds.frame', { n: state.frame })} · {t('miniworlds.actors', { n: state.actors })}
          </>
        ) : (
          t('miniworlds.starting')
        )}
        {state.armed && <div class="mw-armed">{t('miniworlds.armed', { cls: state.armed.cls })}</div>}
      </div>

      <section class="mw-classes" aria-label={t('miniworlds.classes')}>
        <h2>{t('miniworlds.classes')}</h2>
        {actorClasses.length === 0 && <p class="muted small">{t('miniworlds.noClasses')}</p>}
        <div class="mw-class-buttons">
          {actorClasses.map((c) => (
            <button
              type="button"
              key={c.name}
              aria-pressed={state.armed?.cls === c.name}
              disabled={!state.active}
              onClick={() => void controller.arm(state.armed?.cls === c.name ? null : c.name)}
            >
              {t('miniworlds.new', { cls: c.name })}
              {state.byClass[c.name] ? <span class="count"> {state.byClass[c.name]}×</span> : null}
            </button>
          ))}
        </div>
      </section>

      <section class="mw-setup" aria-label={t('miniworlds.start')}>
        <span class="small">
          {steps > 0 ? t('miniworlds.startSteps', { n: steps }) : t('miniworlds.startEmpty')}
          {state.lateEdit && ` — ${t('miniworlds.lateEdit')}`}
        </span>
        <div class="mw-setup-buttons">
          <button type="button" disabled={!state.active || !state.paused} onClick={() => void controller.keepSetup()}>
            {t('miniworlds.keep')}
          </button>
          <button type="button" disabled={steps === 0} onClick={() => (controller.clearSetup(), onReset())}>
            {t('miniworlds.clear')}
          </button>
          <button type="button" disabled={!state.active} onClick={() => void saveWorld()}>
            {t('miniworlds.saveWorld')}
          </button>
        </div>
      </section>
    </div>
  )
}

import { t, useLang } from '../i18n'
import { infoDialog, openDialog } from '../ui/dialogs'
import type { GreenfootController, GreenfootState } from './controller'
import { SPEED_MAX, SPEED_MIN, speedLabel } from './scenario'

interface Props {
  controller: GreenfootController
  state: GreenfootState
  /** Restart the program (stop, then start again with the remembered start setup). */
  onReset: () => void
  /** Insert generated code at the editor's cursor. */
  onInsert: (code: string) => void
}

/** Controls under the world: Act / Run / Pause, speed, Reset, creating actors, start setup, "save the world". */
export function GreenfootControls({ controller, state, onReset, onInsert }: Props) {
  useLang()
  const actorClasses = state.classes.filter((c) => c.is_actor)
  const steps = controller.setupSteps

  async function saveWorld() {
    let code = ''
    try {
      code = (await controller.exportCode()) || t('greenfoot.export.empty')
    } catch (error) {
      return void (await infoDialog(t('dialog.error'), error instanceof Error ? error.message : String(error)))
    }
    await openDialog({
      title: t('greenfoot.export.title'),
      message: t('greenfoot.export.hint'),
      body: <pre class="export-code">{code}</pre>,
      info: true,
      extra: [
        { label: t('greenfoot.export.copy'), onClick: () => void navigator.clipboard?.writeText(code) },
        { label: t('greenfoot.export.insert'), onClick: () => onInsert(code + '\n'), close: true },
      ],
    })
  }

  return (
    <div class="gf">
      <div class="gf-controls">
        <button type="button" disabled={!state.active || !state.paused} onClick={() => void controller.act()}>
          {t('greenfoot.act')}
        </button>
        <button type="button" disabled={!state.active} class="primary-ish" onClick={() => void controller.togglePause()}>
          {state.paused ? `▶ ${t('greenfoot.run')}` : `❚❚ ${t('greenfoot.pause')}`}
        </button>
        <label class="gf-speed">
          <span>{t('greenfoot.speed')}</span>
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
          ↻ {t('greenfoot.reset')}
        </button>
      </div>

      <div class="gf-info" role="status">
        {state.active ? (
          <>
            {t('greenfoot.frame', { n: state.frame })} · {t('greenfoot.actors', { n: state.actors })}
          </>
        ) : (
          t('greenfoot.starting')
        )}
        {state.armed && <div class="gf-armed">{t('greenfoot.armed', { cls: state.armed.cls })}</div>}
      </div>

      <section class="gf-classes" aria-label={t('greenfoot.classes')}>
        <h3>{t('greenfoot.classes')}</h3>
        {actorClasses.length === 0 && <p class="muted small">{t('greenfoot.noClasses')}</p>}
        <div class="gf-class-buttons">
          {actorClasses.map((c) => (
            <button
              type="button"
              key={c.name}
              aria-pressed={state.armed?.cls === c.name}
              disabled={!state.active}
              onClick={() => void controller.arm(state.armed?.cls === c.name ? null : c.name)}
            >
              {t('greenfoot.new', { cls: c.name })}
              {state.byClass[c.name] ? <span class="count"> {state.byClass[c.name]}×</span> : null}
            </button>
          ))}
        </div>
      </section>

      <section class="gf-setup" aria-label={t('greenfoot.start')}>
        <span class="small">
          {steps > 0 ? t('greenfoot.startSteps', { n: steps }) : t('greenfoot.startEmpty')}
          {state.lateEdit && ` — ${t('greenfoot.lateEdit')}`}
        </span>
        <div class="gf-setup-buttons">
          <button type="button" disabled={!state.active || !state.paused} onClick={() => void controller.keepSetup()}>
            {t('greenfoot.keep')}
          </button>
          <button type="button" disabled={steps === 0} onClick={() => (controller.clearSetup(), onReset())}>
            {t('greenfoot.clear')}
          </button>
          <button type="button" disabled={!state.active} onClick={() => void saveWorld()}>
            {t('greenfoot.saveWorld')}
          </button>
        </div>
      </section>
    </div>
  )
}

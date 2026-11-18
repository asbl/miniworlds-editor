import { t, useLang } from '../i18n'
import type { BootStep } from '../runtime/protocol'
import { bootProgress } from './loading'

/**
 * Covers the world while Python comes up: a black rectangle looks broken, so say what is happening and how far it is.
 * Sits on top of the (still empty) canvas, so the world appears in place when it is ready.
 */
export function BootPlaceholder({ step }: { step: BootStep | null }) {
  useLang()
  const progress = bootProgress(step)
  return (
    <div class="boot-placeholder" role="status">
      <strong>{t('world.preparing')}</strong>
      <span>{t('world.preparing.step', { n: progress.step, total: progress.total, what: t(`boot.what.${progress.what}` as const) })}</span>
      <div class="boot-bar" aria-hidden="true">
        <span style={{ width: `${progress.percent}%` }} />
      </div>
      <small>{t('world.preparing.first')}</small>
    </div>
  )
}

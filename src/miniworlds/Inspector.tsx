import { t, useLang } from '../i18n'
import type { ActorInfo, Inspection } from './scenario'

/** The selected actor, live: position, direction and the actor's own fields. Follows the actor while the world runs. */
export function Inspector({ actor, inspection, onClose }: { actor: ActorInfo; inspection: Inspection | null; onClose: () => void }) {
  useLang()
  const fields = Object.entries(inspection?.fields ?? {})
  const round = (n: number) => Math.round(n)
  return (
    <section class="inspector" aria-label={t('inspector.title', { cls: actor.cls })}>
      <div class="inspector-head">
        <strong>{actor.cls}</strong>
        <span class="muted">
          x {round(actor.x)} · y {round(actor.y)} · {t('inspector.direction')} {round(actor.direction)}°
        </span>
        <button type="button" class="inspector-close" onClick={onClose} title={t('inspector.close')} aria-label={t('inspector.close')}>
          ×
        </button>
      </div>
      {fields.length > 0 ? (
        <table class="inspect" aria-label={t('inspector.fields')}>
          <tbody>
            {fields.map(([name, value]) => (
              <tr key={name}>
                <th>{name}</th>
                <td>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p class="muted small inspector-empty">{t('miniworlds.inspect.noFields')}</p>
      )}
      {inspection && Object.keys(inspection.engine).length > 0 && (
        <details>
          <summary class="small muted">{t('miniworlds.inspect.engine')}</summary>
          <table class="inspect">
            <tbody>
              {Object.entries(inspection.engine).map(([name, value]) => (
                <tr key={name}>
                  <th>{name}</th>
                  <td>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  )
}

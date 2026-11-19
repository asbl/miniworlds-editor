import { useMemo, useState } from 'preact/hooks'
import { t, useLang } from '../i18n'
import { chainOf, labelOf, membersOf, type ApiIndex, type ApiMember } from './apiIndex'

interface Props {
  index: ApiIndex | null
  /** The engine class of the class the cursor is in; null outside a class. */
  start: string | null
  onInsert: (member: ApiMember) => void
}

/** What an actor or world can do: searchable, with the first line of the documentation; a click puts it into the code. */
export function ApiPanel({ index, start, onInsert }: Props) {
  useLang()
  const [chosen, setChosen] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const names = useMemo(() => Object.keys(index?.classes ?? {}).sort(), [index])
  const current = chosen && index?.classes[chosen] ? chosen : start && index?.classes[start] ? start : index?.classes.Actor ? 'Actor' : (names[0] ?? null)
  const rows = useMemo(() => (index && current ? membersOf(index, chainOf(index, current), query) : []), [index, current, query])

  if (!index) return <p class="muted small api-note">{t('api.unavailable')}</p>
  return (
    <div class="api-panel">
      <div class="api-tools">
        <label class="api-class">
          <span class="muted small">{start && !chosen ? t('api.forCursor') : t('api.forClass')}</span>
          <select value={current ?? ''} onChange={(e) => setChosen(e.currentTarget.value)} aria-label={t('api.classLabel')}>
            {names.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <input type="search" value={query} placeholder={t('api.search')} aria-label={t('api.search')} onInput={(e) => setQuery(e.currentTarget.value)} />
      </div>
      <p class="muted small api-hint">{t('api.hint')}</p>
      {rows.length === 0 ? (
        <p class="muted small api-note">{t('api.noMatch')}</p>
      ) : (
        <ul class="api-list">
          {rows.map(({ from, member }) => (
            <li key={`${from}.${member.name}`}>
              <button type="button" class="api-row" onClick={() => onInsert(member)} title={t('api.insert')}>
                <span class="api-label">{labelOf(member)}</span>
                {from !== current && <span class="api-from muted small">{t('api.from', { name: from })}</span>}
                {member.doc && <span class="api-doc small">{member.doc}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

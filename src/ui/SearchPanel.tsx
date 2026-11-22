import { useEffect, useRef, useState } from 'preact/hooks'
import { t, useLang } from '../i18n'
import { BadPatternError, replaceInProject, searchProject, type Hit, type ProjectSearchResult, type SearchOptions } from '../project/search'
import { confirmDialog } from './dialogs'
import type { Session } from './session'

const LIMIT = 500

export function SearchPanel({ session, focusSignal, onChanged }: { session: Session; focusSignal: number; onChanged: () => void }) {
  useLang()
  const [options, setOptions] = useState<SearchOptions>({ query: '', caseSensitive: false, regex: false, wholeWord: false })
  const [replacement, setReplacement] = useState('')
  const [result, setResult] = useState<ProjectSearchResult | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [focusSignal])

  // Debounced live search; includes unsaved edits by flushing them first.
  useEffect(() => {
    if (options.query === '') {
      setResult(null)
      setMessage(null)
      return
    }
    let stale = false
    const timer = setTimeout(async () => {
      try {
        await session.saveAll()
        const found = await searchProject(session.fs, options, LIMIT)
        if (stale) return
        setResult(found)
        setMessage(null)
      } catch (error) {
        if (stale) return
        setResult(null)
        setMessage(error instanceof BadPatternError ? t('search.badRegex') : String(error))
      }
    }, 200)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [options, session])

  const toggle = (key: 'caseSensitive' | 'regex' | 'wholeWord') => setOptions((o) => ({ ...o, [key]: !o[key] }))

  async function replaceAll() {
    if (!result || result.hits.length === 0) return
    const ok = await confirmDialog(
      t('search.replaceAll'),
      t('search.hits', { hits: result.truncated ? `${LIMIT}+` : result.hits.length, files: result.files }) + ` → „${replacement}“`,
      false,
    )
    if (!ok) return
    await session.saveAll()
    const done = await replaceInProject(session.fs, options, replacement)
    for (const path of done.changed) await session.reload(path)
    setMessage(t('search.replaced', { count: done.count, files: done.changed.length }))
    setResult(await searchProject(session.fs, options, LIMIT))
    onChanged()
  }

  const byFile = new Map<string, Hit[]>()
  for (const hit of result?.hits ?? []) byFile.set(hit.path, [...(byFile.get(hit.path) ?? []), hit])

  return (
    <div class="search">
      <input
        ref={input}
        type="search"
        placeholder={t('search.find')}
        aria-label={t('search.find')}
        value={options.query}
        onInput={(e) => setOptions({ ...options, query: e.currentTarget.value })}
      />
      <div class="search-toggles">
        <button type="button" aria-pressed={options.caseSensitive} title={t('search.case')} onClick={() => toggle('caseSensitive')}>
          Aa
        </button>
        <button type="button" aria-pressed={options.wholeWord} title={t('search.word')} onClick={() => toggle('wholeWord')}>
          ab
        </button>
        <button type="button" aria-pressed={options.regex} title={t('search.regex')} onClick={() => toggle('regex')}>
          .*
        </button>
      </div>
      <details class="search-replace">
        <summary>{t('search.replaceToggle')}</summary>
        <input type="text" placeholder={t('search.replace')} aria-label={t('search.replace')} value={replacement} onInput={(e) => setReplacement(e.currentTarget.value)} />
        <button type="button" class="wide" disabled={!result || result.hits.length === 0} onClick={() => void replaceAll()}>
          {t('search.replaceAll')}
        </button>
      </details>
      <p class="search-info" role="status">
        {message ??
          (result
            ? result.hits.length === 0
              ? t('search.noHits')
              : t('search.hits', { hits: result.truncated ? `${LIMIT}+` : result.hits.length, files: result.files })
            : '')}
        {result?.truncated ? ` ${t('search.tooMany', { limit: LIMIT })}` : ''}
      </p>
      <ul class="hits">
        {[...byFile].map(([path, hits]) => (
          <li key={path}>
            <div class="hit-file">{path}</div>
            {hits.map((hit) => (
              <button type="button" class="hit" key={`${hit.line}:${hit.column}`} onClick={() => void session.open(hit.path, hit)}>
                <span class="hit-line">{hit.line}</span>
                {hit.preview}
              </button>
            ))}
          </li>
        ))}
      </ul>
    </div>
  )
}

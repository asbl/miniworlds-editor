/**
 * Links that open a task: `?template=krabbe` (a template that ships with the editor) or `?zip=<address>` (a project ZIP,
 * e.g. from the course page); `&name=` names the project, `&lang=de|en` sets the language.
 */
export interface Launch {
  template: string | null
  zip: string | null
  name: string | null
  lang: 'de' | 'en' | null
}

const MAX_NAME = 56

/** The task a link asks for, or null. `base` resolves relative addresses; only http(s) addresses are accepted. */
export function parseLaunch(search: string, base: string): Launch | null {
  const params = new URLSearchParams(search)
  const template = params.get('template')
  let zip: string | null = null
  const rawZip = params.get('zip')
  if (rawZip) {
    try {
      const url = new URL(rawZip, base)
      if (url.protocol === 'https:' || url.protocol === 'http:') zip = url.href
    } catch {
      /* not an address */
    }
  }
  if (!template && !zip) return null
  const name = (params.get('name') ?? '').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, MAX_NAME)
  const lang = params.get('lang')
  return { template: template && /^[a-z0-9-]{1,40}$/i.test(template) ? template.toLowerCase() : null, zip, name: name || null, lang: lang === 'de' || lang === 'en' ? lang : null }
}

/** The address without the launch parameters (shown after the task was opened, so a reload does not repeat it). */
export function withoutLaunch(href: string): string {
  const url = new URL(href)
  for (const key of ['template', 'zip', 'name', 'lang']) url.searchParams.delete(key)
  return url.pathname + (url.search || '') + url.hash
}

const KEY = 'miniworlds-editor.launched'

/** Projects that came from a link: the same link opens the project again instead of making a copy. */
export function launchedProject(source: string): string | null {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string>)[source] ?? null
  } catch {
    return null
  }
}

export function rememberLaunched(source: string, project: string): void {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string>
    all[source] = project
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    /* the link then makes a copy next time */
  }
}

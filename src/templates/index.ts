import type { Lang } from '../i18n'
import { saveMeta } from '../miniworlds/meta'
import { hashText, parseCheck, type Check } from '../tasks/checks'
import { MANIFEST_FILE, serializeManifest } from '../project/manifest'
import type { Fs } from '../workspace'

/** Project templates (from the Miniworlds web client's scenarios, split into one class per file). */
export interface TemplateText {
  title: string
  level: string
  description: string
  /** A text, or a text with an automatic check (`changed` without `hash`: the template's own file is the baseline). */
  tasks: (string | { text: string; check?: unknown })[]
}
export interface Template {
  id: string
  /** Project files, e.g. "main.py", "classes/Krabbe.py". */
  files: Record<string, string>
  text: Record<Lang, TemplateText>
}

const ORDER = ['krabbe', 'sammler', 'pong', 'weltraum', 'huepfer', 'schlange']
const raw = import.meta.glob('./*/**/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

export function loadTemplates(source: Record<string, string> = raw): Template[] {
  const byId = new Map<string, Template>()
  for (const [key, content] of Object.entries(source)) {
    const [, id, ...rest] = key.split('/')
    if (!id || rest.length === 0) continue
    const path = rest.join('/')
    const template = byId.get(id) ?? { id, files: {}, text: {} as Record<Lang, TemplateText> }
    byId.set(id, template)
    const meta = /^scenario\.(de|en)\.json$/.exec(path)
    if (meta) template.text[meta[1] as Lang] = JSON.parse(content) as TemplateText
    else template.files[path] = content
  }
  return [...byId.values()].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id))
}

export const TEMPLATES = loadTemplates()

export interface TemplateRequest {
  template: Template
  lang: Lang
  name: string
  /** Pinned miniworlds version, or null for the newest. */
  miniworlds: string | null
}

/** Writes a project from a template: files, project.toml and the tasks (in miniworlds.json). */
export async function createFromTemplate(fs: Fs, { template, lang, name, miniworlds }: TemplateRequest): Promise<void> {
  await fs.write(MANIFEST_FILE, serializeManifest({ name, miniworlds, entry: 'main.py', packages: [] }))
  for (const [path, content] of Object.entries(template.files)) await fs.write(path, content)
  const text = template.text[lang] ?? template.text.de
  const tasks = text.tasks.map((task) => (typeof task === 'string' ? task : task.text))
  const checks = text.tasks.map((task) => (typeof task === 'string' ? null : resolveCheck(task.check, template.files)))
  await saveMeta(fs, { journal: [], tasks, tasksDone: {}, ...(checks.some((c) => c) ? { checks } : {}) })
}

/** A check from a template's JSON, with the baseline hash of `changed` checks filled in from the template's files. */
export function resolveCheck(raw: unknown, files: Record<string, string>): Check | null {
  const fill = (c: unknown): unknown => {
    if (typeof c !== 'object' || c === null) return c
    const r = c as Record<string, unknown>
    if (r.type === 'changed' && typeof r.path === 'string' && typeof files[r.path] === 'string') return { ...r, hash: hashText(files[r.path] as string) }
    if (r.type === 'all' && Array.isArray(r.of)) return { ...r, of: r.of.map(fill) }
    return c
  }
  return parseCheck(fill(raw))
}

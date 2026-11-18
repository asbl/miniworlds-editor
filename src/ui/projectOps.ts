import { t } from '../i18n'
import { getLang } from '../i18n'
import { createProject } from '../project/create'
import { createFromTemplate, TEMPLATES } from '../templates'
import { exportZip, importZip, ZipError } from '../project/zip'
import { FolderError, importFolder, type FolderSource } from '../project/folder'
import { detectKind } from '../project/manifest'
import { copyAll, validateProjectName, type ProjectStore } from '../workspace'
import { infoDialog, openDialog, confirmDialog } from './dialogs'

const LAST_KEY = 'miniworlds-editor.project'

export function rememberProject(name: string): void {
  try {
    localStorage.setItem(LAST_KEY, name)
  } catch {
    /* ignore */
  }
}
export function lastProject(): string | null {
  try {
    return localStorage.getItem(LAST_KEY)
  } catch {
    return null
  }
}

/** "name" → "name 2" → … until free. */
export async function uniqueProjectName(store: ProjectStore, base: string): Promise<string> {
  const stem = base.trim().slice(0, 56) || t('project.untitled')
  if (!(await store.exists(stem))) return stem
  for (let n = 2; ; n++) if (!(await store.exists(`${stem} ${n}`))) return `${stem} ${n}`
}

function starterNames() {
  return {
    worldName: t('starter.world'),
    actorName: t('starter.actor'),
    worldVar: t('starter.worldVar'),
    actorVar: t('starter.actorVar'),
  }
}

export async function createStarterProject(store: ProjectStore, name: string, kind: 'project' | 'legacy', miniworlds: string | null): Promise<void> {
  const { fs } = await store.open(name)
  await createProject(fs, { kind, name, miniworlds, ...starterNames() })
}

/** Dialog flow; returns the new project's name or null when cancelled. */
export async function promptNewProject(store: ProjectStore, miniworlds: string | null): Promise<string | null> {
  const values = await openDialog({
    title: t('project.new'),
    fields: [
      { kind: 'text', key: 'name', label: t('project.name'), initial: await uniqueProjectName(store, t('project.untitled')) },
      {
        kind: 'radio',
        key: 'kind',
        label: t('project.kind'),
        initial: 'project',
        options: [
          { value: 'project', label: t('project.kind.project'), hint: t('project.kind.project.hint') },
          { value: 'legacy', label: t('project.kind.legacy'), hint: t('project.kind.legacy.hint') },
          ...TEMPLATES.map((tpl) => {
            const text = tpl.text[getLang()] ?? tpl.text.de
            return { value: `tpl:${tpl.id}`, label: t('project.kind.template', { title: text.title, level: text.level }), hint: text.description }
          }),
        ],
      },
    ],
    submit: 'dialog.create',
    validate: async (v) => nameProblem(store, String(v.name)),
  })
  if (!values) return null
  const name = validateProjectName(String(values.name))
  const choice = String(values.kind)
  const template = TEMPLATES.find((tpl) => `tpl:${tpl.id}` === choice)
  if (template) await createFromTemplate((await store.open(name)).fs, { template, lang: getLang(), name, miniworlds })
  else await createStarterProject(store, name, choice as 'project' | 'legacy', miniworlds)
  return name
}

async function nameProblem(store: ProjectStore, raw: string, allowSame?: string): Promise<string | null> {
  let name: string
  try {
    name = validateProjectName(raw)
  } catch {
    return t('project.invalidName')
  }
  return name !== allowSame && (await store.exists(name)) ? t('project.exists') : null
}

export async function promptRenameProject(store: ProjectStore, current: string): Promise<string | null> {
  const values = await openDialog({
    title: t('project.rename'),
    fields: [{ kind: 'text', key: 'name', label: t('project.name'), initial: current }],
    validate: (v) => nameProblem(store, String(v.name), current),
  })
  if (!values) return null
  const name = validateProjectName(String(values.name))
  if (name === current) return current
  const from = await store.open(current)
  const to = await store.open(name)
  await copyAll(from.fs, to.fs)
  if (from.history && to.history) await copyAll(from.history, to.history).catch(() => {}) // the history moves with the project
  await store.remove(current)
  return name
}

export async function duplicateProject(store: ProjectStore, current: string): Promise<string> {
  const name = await uniqueProjectName(store, t('project.copySuffix', { name: current }))
  await copyAll((await store.open(current)).fs, (await store.open(name)).fs)
  return name
}

export async function promptDeleteProject(store: ProjectStore, name: string): Promise<boolean> {
  if (!(await confirmDialog(t('project.delete'), t('project.deleteConfirm', { name })))) return false
  await store.remove(name)
  return true
}

function download(filename: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export async function exportProjectZip(store: ProjectStore, name: string): Promise<void> {
  download(`${name}.zip`, await exportZip((await store.open(name)).fs))
}

/** Creates a project from a ZIP file; returns its name, or null on failure (the user was informed). */
export async function importProjectZip(store: ProjectStore, file: File): Promise<string | null> {
  const base = file.name.replace(/\.zip$/i, '').replace(/[\\/:*?"<>|]/g, '_')
  const name = await uniqueProjectName(store, base)
  const { fs } = await store.open(name)
  try {
    const count = await importZip(fs, new Uint8Array(await file.arrayBuffer()))
    await infoDialog(t('project.importDone', { count }), name)
    return name
  } catch (error) {
    await store.remove(name)
    const reason = error instanceof ZipError ? error.message : String(error)
    await infoDialog(t('dialog.error'), t('project.importFailed', { reason }))
    return null
  }
}

/**
 * Creates a project from a folder (picked or dropped), named like the folder; returns its name, or null on failure
 * (the user was informed). Stays silent on success, except for a hint when the folder does not look like a program.
 */
export async function importProjectFolder(store: ProjectStore, source: Promise<FolderSource> | FolderSource): Promise<string | null> {
  let name: string | null = null
  try {
    const folder = await source
    name = await uniqueProjectName(store, (folder.name ?? t('project.untitled')).replace(/[\\/:*?"<>|]/g, '_'))
    const { fs } = await store.open(name)
    await importFolder(fs, folder)
    if (detectKind(await fs.list()) === 'other') await infoDialog(t('project.importNoMainTitle'), t('project.importNoMain', { name }))
    return name
  } catch (error) {
    if (name) await store.remove(name).catch(() => {})
    const reason = error instanceof FolderError ? t(`project.importReason.${error.code}`) : error instanceof Error ? error.message : String(error)
    await infoDialog(t('dialog.error'), t('project.importFolderFailed', { reason }))
    return null
  }
}

/** Several dropped folders: one project each; returns the first one made, which is the one to show. */
export async function importProjectFolders(store: ProjectStore, sources: Promise<FolderSource[]>): Promise<string | null> {
  let list: FolderSource[]
  try {
    list = await sources
  } catch (error) {
    const reason = error instanceof FolderError ? t(`project.importReason.${error.code}`) : error instanceof Error ? error.message : String(error)
    await infoDialog(t('dialog.error'), t('project.importFolderFailed', { reason }))
    return null
  }
  let first: string | null = null
  for (const source of list) {
    const made = await importProjectFolder(store, source)
    first ??= made
  }
  return first
}

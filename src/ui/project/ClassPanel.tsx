import { useEffect, useState } from 'preact/hooks'
import { t } from '../../i18n'
import { canSubclass, type BaseClass } from '../../project/classes'
import { classImagePath, fitSize, setClassImage } from '../../project/classImage'
import type { ProjectKind } from '../../project/manifest'
import { imageSize, mimeOf } from '../../miniworlds/imageLibrary'
import { recordSource, type ImageSource } from '../../miniworlds/provenance'
import type { useMiniworlds, useMiniworldsMeta } from '../../miniworlds/useMiniworlds'
import { classAtLine, classSource as modelClassSource, type Member, type ModelClass } from '../../uml/model'
import { UmlDiagram } from '../../uml/UmlDiagram'
import type { useClassModel } from '../../uml/useModel'
import type { FileEntry, Fs } from '../../workspace'
import { openContextMenu } from '../ContextMenu'
import { infoDialog } from '../dialogs'
import { ImageDialog } from '../ImageDialog'
import { CostumeDialog } from '../CostumeDialog'
import { ToolbarDialog } from '../ToolbarDialog'
import { readToolbar, setToolbar, type ToolbarSpec } from '../../project/classToolbar'
import { readCostumes, setClassCostumes, type Costumes } from '../../project/classCostumes'
import type { Session } from '../session'

/** What the person set in the diagram (details on/off, the class clicked last): kept while another sidebar tab is shown. */
export function useClassPanelView() {
  const [details, setDetails] = useState(true)
  const [picked, setPicked] = useState<string | null>(null)
  return { details, setDetails, picked, setPicked }
}

interface Props {
  view: ReturnType<typeof useClassPanelView>
  fs: Fs
  session: Session | null
  entries: FileEntry[]
  kind: ProjectKind
  classModel: ReturnType<typeof useClassModel>
  gf: ReturnType<typeof useMiniworlds>
  metaApi: ReturnType<typeof useMiniworldsMeta>
  /** The file and line the cursor is in (marks the class in the diagram). */
  cursor: { path: string; line: number } | null
  stale: Set<string>
  /** Classes whose event methods were just called. */
  fired?: ReadonlySet<string>
  refresh: () => Promise<void>
  onNewClass: (base?: BaseClass) => void
  onRenameClass: (info: ModelClass) => void
  /** "React to …": add a method for an event to this class. */
  onReact: (info: ModelClass) => void
}

/** The class diagram of the project with its tools: show a class, add a new one or a subclass, choose an image. */
export function ClassPanel({ view, fs, session, entries, kind, classModel, gf, metaApi, cursor, stale, fired, refresh, onNewClass, onRenameClass, onReact }: Props) {
  const { details, setDetails, picked: pickedClass, setPicked: setPickedClass } = view
  const [imageFor, setImageFor] = useState<string | null>(null)
  const [costumesFor, setCostumesFor] = useState<string | null>(null)
  const [toolbarFor, setToolbarFor] = useState<string | null>(null)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const cursorClass = classModel.model && cursor ? classAtLine(classModel.model, cursor.path, cursor.line) : null

  // thumbnails of class images in the diagram
  useEffect(() => {
    if (!classModel.model) return
    const urls: string[] = []
    let outdated = false
    void (async () => {
      const out: Record<string, string> = {}
      for (const c of classModel.model?.classes ?? []) {
        const path = classImagePath(modelClassSource(c, classModel.files))
        if (!path || !(await fs.exists(path))) continue
        const url = URL.createObjectURL(new Blob([(await fs.readBytes(path)) as BlobPart], { type: mimeOf(path) }))
        urls.push(url)
        out[c.name] = url
      }
      if (!outdated) setThumbs(out)
    })()
    return () => {
      outdated = true
      urls.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [classModel.model, classModel.files, fs, entries])

  async function applyImage(className: string, path: string, source?: ImageSource) {
    setImageFor(null)
    const info = classModel.model?.classes.find((c) => c.name === className)
    if (!info || !session) return
    if (source) metaApi.setMeta({ ...metaApi.metaRef.current, images: recordSource(metaApi.metaRef.current.images, path, source) })
    const isWorld = info.kind === 'world'
    const size = isWorld ? null : await imageSize(await fs.readBytes(path), path).then((d) => (d ? fitSize(d[0], d[1]) : null))
    const edit = setClassImage(await session.readText(info.file), info, path, size, isWorld ? 'background' : 'costume')
    if (!edit.ok) return void (await infoDialog(t('dialog.error'), t('image.oneLineSetup', { name: className, path })))
    await session.writeText(info.file, edit.text)
    await refresh()
    classModel.refresh()
  }

  async function applyCostumes(className: string, costumes: Costumes) {
    setCostumesFor(null)
    const info = classModel.model?.classes.find((c) => c.name === className)
    const first = costumes.frames[0]
    if (!info || !session || !first) return
    const dims = await imageSize(await fs.readBytes(first), first)
    const edit = setClassCostumes(await session.readText(info.file), info, costumes, dims ? fitSize(dims[0], dims[1]) : null)
    if (!edit.ok) return void (await infoDialog(t('dialog.error'), t('image.oneLineSetup', { name: className, path: first })))
    await session.writeText(info.file, edit.text)
    await refresh()
    classModel.refresh()
  }

  async function applyToolbar(className: string, spec: ToolbarSpec, handler: boolean) {
    setToolbarFor(null)
    const info = classModel.model?.classes.find((c) => c.name === className)
    if (!info || !session) return
    const edit = setToolbar(await session.readText(info.file), info, spec, handler)
    if (!edit.ok) return void (await infoDialog(t('dialog.error'), t('toolbar.oneLineSetup', { name: className })))
    await session.writeText(info.file, edit.text)
    await refresh()
    classModel.refresh()
    void session.open(info.file, { line: info.line, column: 0, length: 0 })
  }

  function baseOf(info: ModelClass | null, name: string): BaseClass | null {
    if (info) return { name, user: true, kind: info.kind, file: info.file }
    const lib = classModel.model?.libraries.find((l) => l.name === name)
    return lib ? { name, user: false, kind: lib.kind } : null
  }

  function onSelect(info: ModelClass | null, name: string) {
    setPickedClass(name)
    if (info) void session?.open(info.file, { line: info.line, column: 0, length: 0 })
  }

  function onMember(info: ModelClass, _kind: 'attribute' | 'method', member: Member) {
    setPickedClass(info.name)
    void session?.open(info.file, { line: member.line, column: 0, length: 0 })
  }

  function onMenu(event: Pick<MouseEvent, 'clientX' | 'clientY'>, info: ModelClass | null, name: string) {
    const base = baseOf(info, name)
    const items: Parameters<typeof openContextMenu>[2] = [{ header: name }]
    if (info?.kind === 'actor') {
      items.push(
        gf.state.active
          ? { text: t('uml.menu.newObject', { name }), run: () => void gf.controller.arm(name) }
          : { header: t('uml.menu.noWorld') },
      )
    }
    if (info) items.push({ text: t('uml.menu.source'), run: () => onSelect(info, name) })
    if (info && (info.kind === 'actor' || info.kind === 'world')) items.push({ text: t('uml.menu.react'), run: () => onReact(info) })
    if (info && kind === 'project') items.push({ text: t('class.rename'), run: () => onRenameClass(info) })
    if (info?.kind === 'actor') items.push({ text: t('uml.menu.costumes'), run: () => setCostumesFor(name) })
    if (info?.kind === 'world') items.push({ text: t('uml.menu.background'), run: () => setImageFor(name) })
    if (info?.kind === 'world') items.push({ text: t('uml.menu.toolbar'), run: () => setToolbarFor(name) })
    if (base && kind === 'project' && canSubclass(base)) {
      items.push('-', { text: t('uml.menu.subclass', { name }), run: () => onNewClass(base) })
    }
    if (items.length > 1) openContextMenu(event.clientX, event.clientY, items)
  }

  const toolbarClass = toolbarFor ? classModel.model?.classes.find((x) => x.name === toolbarFor) : undefined
  const costumeClass = costumesFor ? classModel.model?.classes.find((x) => x.name === costumesFor) : undefined
  const imageClass = imageFor ? classModel.model?.classes.find((x) => x.name === imageFor) : undefined

  return (
    <div class="uml-panel">
      <div class="uml-tools">
        <label class="inline small">
          <input type="checkbox" checked={details} onChange={(e) => setDetails(e.currentTarget.checked)} />
          <span>{t('uml.details')}</span>
        </label>
        <button type="button" disabled={kind !== 'project'} onClick={() => onNewClass()}>
          {t('uml.newClass')}
        </button>
      </div>
      {classModel.status !== 'ready' && <p class="muted small uml-note">{t(`uml.${classModel.status}` as const)}</p>}
      {classModel.model && classModel.model.errors.length > 0 && (
        <p class="uml-note small error-text">{t('uml.syntaxFiles', { files: classModel.model.errors.map((e) => e.file).join(', ') })}</p>
      )}
      <div class="uml-scroll">
        {classModel.model && (
          <UmlDiagram
            model={classModel.model}
            details={details}
            counts={gf.state.byClass}
            marks={{ selected: pickedClass, cursor: cursorClass, object: gf.state.selected?.cls ?? null, armed: gf.state.armed?.cls ?? null, fired }}
            stale={stale}
            images={thumbs}
            onSelect={onSelect}
            onMember={onMember}
            onMenu={onMenu}
          />
        )}
      </div>
      {toolbarFor && toolbarClass && (
        <ToolbarDialog
          className={toolbarFor}
          initial={readToolbar(modelClassSource(toolbarClass, classModel.files))}
          hasHandler={toolbarClass.methods.some((m) => m.name === 'on_message')}
          onApply={(spec, handler) => void applyToolbar(toolbarFor, spec, handler)}
          onClose={() => setToolbarFor(null)}
        />
      )}
      {costumesFor && costumeClass && (
        <CostumeDialog
          fs={fs}
          className={costumesFor}
          initial={readCostumes(modelClassSource(costumeClass, classModel.files))}
          onSource={(path, source) => metaApi.setMeta({ ...metaApi.metaRef.current, images: recordSource(metaApi.metaRef.current.images, path, source) })}
          onApply={(costumes) => void applyCostumes(costumesFor, costumes)}
          onClose={() => setCostumesFor(null)}
        />
      )}
      {imageFor && (
        <ImageDialog
          fs={fs}
          className={imageFor}
          mode={imageClass?.kind === 'world' ? 'world' : 'actor'}
          current={imageClass ? classImagePath(modelClassSource(imageClass, classModel.files)) : null}
          onChoose={(path, source) => void applyImage(imageFor, path, source)}
          onClose={() => setImageFor(null)}
        />
      )}
    </div>
  )
}

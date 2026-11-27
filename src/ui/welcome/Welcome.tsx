import { useEffect, useRef, useState } from 'preact/hooks'
import { t, useLang } from '../../i18n'
import { TEMPLATES } from '../../templates'
import { dragHasFiles } from '../../project/folder'

/** What the import hints can start; the app owns the file pickers and the project creation. */
export interface ImportActions {
  pickFolder(): void
  pickZip(): void
  pickFiles(): void
  /** Plain files (no folder) dropped on the drop area. */
  dropFiles(files: File[]): void
}

function Modal({ label, onClose, children }: { label: string; onClose: () => void; children: preact.ComponentChildren }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])
  return (
    <dialog ref={ref} class="dialog welcome" aria-label={label} onCancel={(e) => (e.preventDefault(), onClose())}>
      <div class="welcome-body">{children}</div>
    </dialog>
  )
}

/** The ways to get an existing program into the editor, with the buttons that do it. Used in the welcome card and as its own dialog. */
export function ImportWays({ actions }: { actions: ImportActions }) {
  useLang()
  const [over, setOver] = useState(false)
  return (
    <div class="import-ways">
      <p class="muted">{t('import.intro')}</p>
      <div
        class={over ? 'drop-zone over' : 'drop-zone'}
        onDragOver={(e) => {
          if (dragHasFiles(e.dataTransfer)) {
            e.preventDefault()
            setOver(true)
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          setOver(false)
          // a dropped folder is taken by the app's capture handler before it gets here
          const files = Array.from(e.dataTransfer?.files ?? [])
          if (files.length === 0) return
          e.preventDefault()
          e.stopPropagation()
          actions.dropFiles(files)
        }}
      >
        {t('import.drop')}
      </div>
      <ul class="import-list">
        <li><button type="button" onClick={actions.pickFolder}>{t('import.folder.button')}</button></li>
        <li><button type="button" onClick={actions.pickZip}>{t('import.zip.button')}</button></li>
        <li><button type="button" onClick={actions.pickFiles}>{t('import.files.button')}</button></li>
      </ul>
    </div>
  )
}

/** "How do I import my program?" – opened from the project menu. */
export function ImportGuide({ actions, onClose }: { actions: ImportActions; onClose: () => void }) {
  useLang()
  return (
    <Modal label={t('import.title')} onClose={onClose}>
      <h2>{t('import.title')}</h2>
      <ImportWays actions={actions} />
      <div class="dialog-buttons">
        <button type="button" class="primary" onClick={onClose}>
          {t('dialog.close')}
        </button>
      </div>
    </Modal>
  )
}

export interface WelcomeProps {
  actions: ImportActions
  /** Start with a template that has tasks. */
  onTemplate(id: string): void
  /** Keep the empty starter project. */
  onStart(): void
  /** Open the project behind a teacher's code; missing where no server is set up. */
  onCode?: () => void
}

/** The one-time card for a visitor who has never used the editor: what to click first, and how to bring a program along. */
export function Welcome({ actions, onTemplate, onStart, onCode }: WelcomeProps) {
  const lang = useLang()
  const [importing, setImporting] = useState(false)
  return (
    <Modal label={t('welcome.title')} onClose={onStart}>
      <h2>{t('welcome.title')}</h2>
      <div class="welcome-ways">
        {onCode && (
          <button type="button" class="welcome-way welcome-code" onClick={onCode}>
            <span class="welcome-icon" aria-hidden="true">🔑</span>
            <strong>{t('welcome.code')}</strong>
            <span>{t('welcome.code.text')}</span>
          </button>
        )}
        <button type="button" class="welcome-way welcome-import" aria-expanded={importing} onClick={() => setImporting((v) => !v)}>
          <span class="welcome-icon" aria-hidden="true">📂</span>
          <strong>{t('welcome.import')}</strong>
          <span>{t('welcome.import.text')}</span>
        </button>
      </div>
      {importing && <ImportWays actions={actions} />}
      <div class="welcome-choices">
        <button type="button" class="welcome-card primary-card" onClick={onStart} autofocus>
          <strong>{t('welcome.empty')}</strong>
          <span>{t('welcome.empty.text')}</span>
        </button>
        {TEMPLATES.map((template) => {
          const text = template.text[lang] ?? template.text.de
          return (
            <button type="button" class="welcome-card" key={template.id} onClick={() => onTemplate(template.id)}>
              <strong>{text.title}</strong>
              <small>{text.level}</small>
              <span>{text.description}</span>
            </button>
          )
        })}
      </div>
    </Modal>
  )
}

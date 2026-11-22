import { useState } from 'preact/hooks'
import { t, useLang } from '../../i18n'
import { TEMPLATES } from '../../templates'

/** Choose what to start with before exposing the optional single-file layout. */
export function ProjectChoices({ onChange }: { onChange: (kind: string) => void }) {
  const lang = useLang()
  const [intent, setIntent] = useState<'own' | 'template'>('own')
  const [singleFile, setSingleFile] = useState(false)
  const [template, setTemplate] = useState(TEMPLATES[0]?.id ?? '')
  const chooseIntent = (next: 'own' | 'template') => {
    setIntent(next)
    onChange(next === 'own' ? singleFile ? 'legacy' : 'project' : `tpl:${template}`)
  }
  return (
    <div class="project-choices">
      <fieldset class="project-intent">
        <legend>{t('project.startWith')}</legend>
        <label class="inline"><input type="radio" name="project-intent" checked={intent === 'own'} onChange={() => chooseIntent('own')} />{t('project.own')}</label>
        <label class="inline"><input type="radio" name="project-intent" checked={intent === 'template'} onChange={() => chooseIntent('template')} />{t('project.fromTemplate')}</label>
      </fieldset>
      {intent === 'template' ? (
        <fieldset class="project-templates">
          <legend>{t('project.fromTemplate')}</legend>
          {TEMPLATES.map((tpl) => {
            const text = tpl.text[lang] ?? tpl.text.de
            return <label class="inline" key={tpl.id}>
              <input type="radio" name="project-template" checked={template === tpl.id} onChange={() => { setTemplate(tpl.id); onChange(`tpl:${tpl.id}`) }} />
              <span>{t('project.kind.template', { title: text.title, level: text.level })}<small class="muted">{text.description}</small></span>
            </label>
          })}
        </fieldset>
      ) : (
        <details>
          <summary>{t('project.moreOptions')}</summary>
          <label class="inline"><input type="checkbox" checked={singleFile} onChange={(e) => {
            setSingleFile(e.currentTarget.checked)
            onChange(e.currentTarget.checked ? 'legacy' : 'project')
          }} />{t('project.kind.legacy')}</label>
        </details>
      )}
    </div>
  )
}

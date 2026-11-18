import { describe, expect, it } from 'vitest'
import { detectKind } from '../project/manifest'
import { MemoryFs } from '../workspace'
import { loadMeta } from '../miniworlds/meta'
import { hashText, type Check } from '../tasks/checks'
import { createFromTemplate, loadTemplates, resolveCheck, TEMPLATES } from './index'

describe('templates', () => {
  it('ships krabbe, sammler and pong in that order', () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(['krabbe', 'sammler', 'pong'])
  })

  it('has texts and tasks in both languages', () => {
    for (const t of TEMPLATES) {
      for (const lang of ['de', 'en'] as const) {
        expect(t.text[lang]?.title, `${t.id}/${lang}`).toBeTruthy()
        expect(t.text[lang]?.tasks.length, `${t.id}/${lang}`).toBeGreaterThan(0)
      }
      expect(t.text.de.tasks).toHaveLength(t.text.en.tasks.length)
    }
  })

  it('every template starts with main.py and its imports point at existing class files', () => {
    for (const t of TEMPLATES) {
      expect(t.files['main.py'], t.id).toContain('.run()')
      for (const [path, source] of Object.entries(t.files)) {
        for (const m of source.matchAll(/^from classes\.(\w+) import (\w+)$/gm)) {
          expect(m[1]).toBe(m[2])
          expect(t.files[`classes/${m[1]}.py`], `${t.id}/${path} imports ${m[1]}`).toBeDefined()
        }
      }
    }
  })

  it('main.py imports every class (the Miniworlds view only sees classes whose module was loaded)', () => {
    for (const t of TEMPLATES) {
      for (const path of Object.keys(t.files)) {
        const m = /^classes\/(\w+)\.py$/.exec(path)
        if (m) expect(t.files['main.py'], `${t.id}: ${m[1]}`).toContain(`from classes.${m[1]} import ${m[1]}`)
      }
    }
  })

  it('class files hold exactly one class named like the file', () => {
    for (const t of TEMPLATES) {
      for (const [path, source] of Object.entries(t.files)) {
        const m = /^classes\/(\w+)\.py$/.exec(path)
        if (!m) continue
        expect([...source.matchAll(/^class (\w+)/gm)].map((x) => x[1]), `${t.id}/${path}`).toEqual([m[1]])
      }
    }
  })

  it('creates a project with project.toml, class files and the tasks in the chosen language', async () => {
    const fs = new MemoryFs()
    await createFromTemplate(fs, { template: TEMPLATES[0]!, lang: 'en', name: 'Crab', miniworlds: '4.4.0.16' })
    expect(detectKind(await fs.list())).toBe('project')
    expect(await fs.exists('classes/Krabbe.py')).toBe(true)
    const meta = await loadMeta(fs)
    expect(meta.tasks[0]).toMatch(/Right-click/)
    expect(await fs.read('project.toml')).toContain('miniworlds = "4.4.0.16"')
  })

  it('carries the same automatic checks in both languages, and `changed` checks name existing files', () => {
    for (const t of TEMPLATES) {
      const checks = (lang: 'de' | 'en') => t.text[lang].tasks.map((task) => (typeof task === 'string' ? null : task.check ?? null))
      expect(checks('de'), t.id).toEqual(checks('en'))
      for (const c of checks('de')) {
        const parsed = resolveCheck(c, t.files)
        if (c) expect(parsed, `${t.id}: ${JSON.stringify(c)}`).not.toBeNull()
        const walk = (x: Check | null) => {
          if (x?.type === 'changed') expect(t.files[x.path], `${t.id}/${x.path}`).toBeDefined()
          if (x?.type === 'all') x.of.forEach(walk)
        }
        walk(parsed)
      }
    }
  })

  it('stores the checks next to the tasks, with the template file as the baseline of `changed`', async () => {
    const fs = new MemoryFs()
    await createFromTemplate(fs, { template: TEMPLATES[0]!, lang: 'de', name: 'Krabbe', miniworlds: null })
    const meta = await loadMeta(fs)
    expect(meta.checks).toHaveLength(meta.tasks.length)
    const changed = meta.checks?.find((c) => c?.type === 'changed')
    expect(changed).toMatchObject({ type: 'changed', path: 'classes/Krabbe.py', hash: hashText(TEMPLATES[0]!.files['classes/Krabbe.py']!) })
  })

  it('ignores files outside template folders', () => {
    expect(loadTemplates({ './stray.txt': 'x' })).toEqual([])
  })
})

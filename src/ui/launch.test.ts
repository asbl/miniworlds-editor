import { describe, expect, it } from 'vitest'
import { parseLaunch, withoutLaunch } from './launch'

const base = 'https://editor.example.org/app/'

describe('parseLaunch', () => {
  it('ignores addresses without a task', () => {
    expect(parseLaunch('', base)).toBeNull()
    expect(parseLaunch('?embed=1', base)).toBeNull()
  })
  it('reads a template and its options', () => {
    expect(parseLaunch('?template=Krabbe&name=Aufgabe%201&lang=en', base)).toEqual({ template: 'krabbe', zip: null, name: 'Aufgabe 1', lang: 'en' })
  })
  it('resolves a relative ZIP address against the editor', () => {
    expect(parseLaunch('?zip=tasks/a.zip', base)?.zip).toBe('https://editor.example.org/app/tasks/a.zip')
  })
  it('accepts only web addresses', () => {
    expect(parseLaunch('?zip=javascript:alert(1)', base)).toBeNull()
    expect(parseLaunch('?zip=data:text/plain,x', base)).toBeNull()
    expect(parseLaunch('?zip=file:///etc/passwd', base)).toBeNull()
  })
  it('keeps names safe for the file system', () => {
    expect(parseLaunch('?template=x&name=a/b:c', base)?.name).toBe('a_b_c')
    expect(parseLaunch('?template=../x', base)?.template).toBeNull()
  })
})

describe('withoutLaunch', () => {
  it('removes the task and keeps the rest', () => {
    expect(withoutLaunch('https://e.org/?template=krabbe&name=x&foo=1#h')).toBe('/?foo=1#h')
    expect(withoutLaunch('https://e.org/app/?zip=a.zip')).toBe('/app/')
  })
})

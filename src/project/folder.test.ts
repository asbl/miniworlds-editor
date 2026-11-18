import { describe, expect, it } from 'vitest'
import { MemoryFs } from '../workspace'
import { fromFileList, importFolder, FolderError } from './folder'

function file(path: string, content = 'x'): File {
  const f = new File([content], path.split('/').pop() as string)
  Object.defineProperty(f, 'webkitRelativePath', { value: path })
  return f
}

describe('folder import', () => {
  it('strips the folder name and keeps the structure', async () => {
    const source = fromFileList([file('Krabbe/main.py', 'print(1)'), file('Krabbe/images/crab.png', 'PNG'), file('Krabbe/classes/Crab.py')])
    expect(source.name).toBe('Krabbe')
    const fs = new MemoryFs()
    expect(await importFolder(fs, source)).toBe(3)
    expect((await fs.list()).map((e) => e.path)).toEqual(['classes', 'classes/Crab.py', 'images', 'images/crab.png', 'main.py'])
    expect(await fs.read('main.py')).toBe('print(1)')
  })
  it('leaves out junk, IDE files and virtual environments', () => {
    const source = fromFileList([
      file('P/main.py'),
      file('P/__pycache__/main.cpython-312.pyc'),
      file('P/.idea/workspace.xml'),
      file('P/venv/lib/python3.12/site-packages/x.py'),
      file('P/.DS_Store'),
      file('P/.git/HEAD'),
    ])
    expect(source.files.map((f) => f.path)).toEqual(['main.py'])
  })
  it('imports a folder that is itself called like an IDE or environment directory', () => {
    const source = fromFileList([file('venv/main.py'), file('venv/lib/site-packages/x.py')])
    expect(source.name).toBe('venv')
    expect(source.files.map((f) => f.path)).toEqual(['main.py'])
  })
  it('has no name when files do not share a folder', () => {
    expect(fromFileList([file('a.py'), file('b.py')]).name).toBeNull()
  })
  it('refuses an empty folder', async () => {
    await expect(importFolder(new MemoryFs(), fromFileList([file('P/.DS_Store')]))).rejects.toBeInstanceOf(FolderError)
  })
})

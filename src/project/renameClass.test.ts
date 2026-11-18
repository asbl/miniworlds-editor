import { describe, expect, it } from 'vitest'
import { findNameClash, renameClass } from './renameClass'

const files = {
  'main.py': 'from classes.Figur import Figur\nfrom classes.Spielfeld import Spielfeld\n\nwelt = Spielfeld(400, 300)\nfigur = Figur((200, 150))  # Figur\nprint("Figur", f"{Figur}")\nwelt.run()\n',
  'classes/Figur.py': 'import miniworlds as mw\n\n\nclass Figur(mw.Circle):\n    def __init__(self, position=(0, 0)):\n        super().__init__(position, 15)\n\n    def act(self):\n        self.move(1)\n        self.Figur = 1\n',
  'classes/Spielfeld.py': 'import miniworlds as mw\nfrom classes.Figur import Figur\n\n\nclass Spielfeld(mw.World):\n    def on_setup(self):\n        Figur((10, 10))\n',
  'notes.txt': 'Figur bleibt hier',
}

describe('renameClass', () => {
  const result = renameClass(files, 'Figur', 'Held')

  it('renames the definition, the imports and the uses', () => {
    expect(result.texts['main.py']).toContain('from classes.Held import Held')
    expect(result.texts['main.py']).toContain('figur = Held((200, 150))')
    expect(result.texts['classes/Figur.py']).toContain('class Held(mw.Circle):')
    expect(result.texts['classes/Spielfeld.py']).toContain('from classes.Held import Held')
    expect(result.texts['classes/Spielfeld.py']).toContain('Held((10, 10))')
  })

  it('leaves strings, comments, attributes and other file types alone', () => {
    expect(result.texts['main.py']).toContain('# Figur')
    expect(result.texts['main.py']).toContain('print("Figur", f"{Held}")')
    expect(result.texts['classes/Figur.py']).toContain('self.Figur = 1')
    expect(result.texts['notes.txt']).toBeUndefined()
  })

  it('moves the class file along', () => {
    expect(result.move).toEqual({ from: 'classes/Figur.py', to: 'classes/Held.py' })
  })

  it('counts the places', () => {
    expect(result.count).toBe(8)
  })

  it('does not touch files that do not mention the class', () => {
    const r = renameClass({ ...files, 'other.py': 'x = 1\n' }, 'Figur', 'Held')
    expect(r.texts['other.py']).toBeUndefined()
  })

  it('keeps an alias and renames only what is imported', () => {
    const r = renameClass({ 'a.py': 'from classes.Figur import Figur as F\nF()\n', 'classes/Figur.py': 'class Figur:\n    pass\n' }, 'Figur', 'Held')
    expect(r.texts['a.py']).toBe('from classes.Held import Held as F\nF()\n')
  })

  it('leaves a file alone where the name comes from another module', () => {
    const r = renameClass({ 'a.py': 'from tools.Figur import Figur\nFigur()\n' }, 'Figur', 'Held')
    expect(r.texts['a.py']).toBeUndefined()
  })

  it('renames "import classes.Figur"', () => {
    const r = renameClass({ 'a.py': 'import classes.Figur\n' }, 'Figur', 'Held')
    expect(r.texts['a.py']).toBe('import classes.Held\n')
  })

  it('has no move when the class does not live in its own file', () => {
    expect(renameClass({ 'main.py': 'class Figur:\n    pass\nFigur()\n' }, 'Figur', 'Held').move).toBeNull()
  })
})

describe('findNameClash', () => {
  const texts = {
    'main.py': 'import random\nfrom classes.Figur import Figur\n\nzahl = 3\n\n\ndef start(tempo):\n    return tempo\n',
    'classes/Figur.py': 'class Figur:\n    def act(self):\n        self.Held = 1  # Held\n        print("Hund")\n',
  }

  it('finds variables, functions, parameters and imports', () => {
    expect(findNameClash(texts, 'zahl')).toEqual({ kind: 'used', path: 'main.py', line: 4 })
    expect(findNameClash(texts, 'start')).toEqual({ kind: 'used', path: 'main.py', line: 7 })
    expect(findNameClash(texts, 'tempo')).toEqual({ kind: 'used', path: 'main.py', line: 7 })
    expect(findNameClash(texts, 'random')).toEqual({ kind: 'used', path: 'main.py', line: 1 })
  })

  it('finds a class that exists under that name in some file', () => {
    expect(findNameClash(texts, 'Figur')).toEqual({ kind: 'used', path: 'main.py', line: 2 })
  })

  it('refuses the names of Python itself', () => {
    expect(findNameClash(texts, 'list')).toEqual({ kind: 'builtin' })
    expect(findNameClash(texts, 'print')).toEqual({ kind: 'builtin' })
  })

  it('ignores attributes, strings and comments, and names that are free', () => {
    expect(findNameClash(texts, 'Held')).toBeNull()
    expect(findNameClash(texts, 'Hund')).toBeNull()
    expect(findNameClash(texts, 'Katze')).toBeNull()
  })
})

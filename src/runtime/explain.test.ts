import { describe, expect, it } from 'vitest'
import { errorNote, explainError, parseFinalError, typoFix } from './explain'

const tb = (last: string) => `Traceback (most recent call last):\n  File "/project/classes/Krabbe.py", line 12, in act\n    self.mov(2)\n${last}`

describe('parseFinalError', () => {
  it('takes the last exception line', () => {
    expect(parseFinalError(tb("AttributeError: 'Krabbe' object has no attribute 'mov'. Did you mean: 'move'?"))).toEqual({
      kind: 'AttributeError',
      message: "'Krabbe' object has no attribute 'mov'. Did you mean: 'move'?",
    })
  })
  it('knows a bare exception name and dotted types', () => {
    expect(parseFinalError('ZeroDivisionError')?.kind).toBe('ZeroDivisionError')
    expect(parseFinalError("pygame.error: Unable to open file 'x'")?.kind).toBe('error')
  })
  it('finds nothing in output that is not a traceback', () => {
    expect(parseFinalError('Hallo Welt')).toBeNull()
    expect(parseFinalError('')).toBeNull()
  })
})

describe('explainError (German)', () => {
  const de = (last: string) => explainError(tb(last), 'de')
  it('turns "Did you mean" into advice', () => {
    expect(de("AttributeError: 'Krabbe' object has no attribute 'mov'. Did you mean: 'move'?")).toMatch(/move/)
    expect(de("NameError: name 'welt' is not defined. Did you mean: 'Welt'?")).toMatch(/Welt/)
  })
  it('explains None, missing arguments, self, wrong types', () => {
    expect(de("AttributeError: 'NoneType' object has no attribute 'x'")).toMatch(/nichts|None/)
    expect(de("TypeError: Krabbe.fressen() missing 1 required positional argument: 'menge'")).toMatch(/menge/)
    expect(de("TypeError: Krabbe.act() missing 1 required positional argument: 'self'")).toMatch(/self/)
    expect(de('TypeError: Krabbe.act() takes 1 positional argument but 2 were given')).toMatch(/self/)
    expect(de('TypeError: can only concatenate str (not "int") to str')).toMatch(/str\(/)
    expect(de("TypeError: unsupported operand type(s) for +: 'int' and 'str'")).toMatch(/int.*str/s)
  })
  it('explains errors around numbers, lists and files', () => {
    expect(de('ZeroDivisionError: division by zero')).toMatch(/Null/)
    expect(de('IndexError: list index out of range')).toMatch(/0/)
    expect(de("ValueError: invalid literal for int() with base 10: 'abc'")).toMatch(/abc/)
    expect(de("FileNotFoundError: [Errno 2] No such file or directory: 'images/fisch.png'")).toMatch(/images\/fisch\.png/)
    expect(de("FileNotFoundError: No file 'images/fisch.png' found in working directory '/project'.")).toMatch(/images\/fisch\.png/)
  })
  it('explains imports, including the classes folder and circles', () => {
    expect(de("ModuleNotFoundError: No module named 'classes.Hai'")).toMatch(/classes\/Hai\.py|Datei/)
    expect(de("ModuleNotFoundError: No module named 'requests'")).toMatch(/Paket/)
    expect(de("ImportError: cannot import name 'Wurm' from partially initialized module 'classes.Wurm' (most likely due to a circular import)")).toMatch(/gegenseitig/)
  })
  it('explains syntax and indentation errors', () => {
    expect(explainError('  File "/project/main.py", line 3\n    if x\n        ^\nSyntaxError: expected \':\'', 'de')).toMatch(/Doppelpunkt/)
    expect(explainError("SyntaxError: '(' was never closed", 'de')).toMatch(/\(/)
    expect(explainError('IndentationError: expected an indented block after \'if\' statement on line 4', 'de')).toMatch(/eingerückt/)
    expect(explainError('IndentationError: unexpected indent', 'de')).toMatch(/eingerückt/)
    expect(explainError('SyntaxError: invalid syntax', 'de')).toMatch(/Zeile/)
  })
  it('says nothing when it has no good advice', () => {
    expect(de('RuntimeError: etwas Eigenes')).toBeNull()
    expect(explainError('Hallo', 'de')).toBeNull()
  })
})

describe('explainError (English)', () => {
  it('answers in English', () => {
    expect(explainError(tb("AttributeError: 'Krabbe' object has no attribute 'mov'. Did you mean: 'move'?"), 'en')).toMatch(/Did you mean|move/)
    expect(explainError('ZeroDivisionError: division by zero', 'en')).toMatch(/zero/i)
  })
})

describe('errorNote', () => {
  const trace = 'Traceback (most recent call last):\n  File "/project/main.py", line 3, in <module>\n    print(nme)\nNameError: name \'nme\' is not defined'
  it('names the exception and carries the tip', () => {
    const note = errorNote(trace, 'en')
    expect(note?.title).toBe("NameError: name 'nme' is not defined")
    expect(note?.tip).toBe(explainError(trace, 'en'))
    expect(note?.tip).toBeTruthy()
  })
  it('has no tip for an error without advice, but still the title', () => {
    const note = errorNote('Traceback (most recent call last):\nMyOwnError: something', 'en')
    expect(note).toEqual({ title: 'MyOwnError: something', tip: null })
  })
  it('is null when no exception can be read', () => {
    expect(errorNote('just some output', 'en')).toBeNull()
  })
})

describe('typoFix', () => {
  it('reads the misspelt attribute and the suggestion', () => {
    const trace = "Traceback (most recent call last):\n  File \"/project/main.py\", line 3, in <module>\nAttributeError: 'Figur' object has no attribute 'mov'. Did you mean: 'move'?"
    expect(typoFix(trace)).toEqual({ wrong: 'mov', right: 'move' })
    expect(errorNote(trace, 'de')?.fix).toEqual({ wrong: 'mov', right: 'move' })
  })

  it('reads a misspelt name', () => {
    expect(typoFix("NameError: name 'welt' is not defined. Did you mean: 'Welt'?")).toEqual({ wrong: 'welt', right: 'Welt' })
  })

  it('offers nothing without a suggestion', () => {
    expect(typoFix("AttributeError: 'Figur' object has no attribute 'xyz'")).toBeNull()
    expect(typoFix("ZeroDivisionError: division by zero")).toBeNull()
  })
})

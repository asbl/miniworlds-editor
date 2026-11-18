import { describe, expect, it } from 'vitest'
import { explainError } from './hints'

const tb = (last: string) => `Traceback (most recent call last):\n  File "/project/main.py", line 3, in <module>\n    x\n${last}`
const de = (last: string) => explainError(tb(last), 'de')

describe('explainError', () => {
  it('explains a missing name and uses the suggestion', () => {
    expect(de("NameError: name 'figur' is not defined")).toContain('„figur“')
    expect(de("NameError: name 'figur' is not defined. Did you mean: 'Figur'?")).toContain('Meintest du „Figur“')
  })
  it('speaks both languages', () => {
    expect(explainError(tb("NameError: name 'x' is not defined"), 'en')).toContain('The name "x" is not known')
  })
  it('explains syntax errors', () => {
    expect(de("SyntaxError: expected ':'")).toContain('Doppelpunkt')
    expect(de("SyntaxError: '(' was never closed")).toContain('Klammer „(“')
    expect(de('SyntaxError: unterminated string literal (detected at line 2)')).toContain('Anführungszeichen')
    expect(de('SyntaxError: invalid syntax')).toContain('Python versteht diese Zeile nicht')
    expect(de('IndentationError: expected an indented block after \'if\' statement on line 1')).toContain('eingerückt')
  })
  it('explains attribute errors, also for None', () => {
    expect(de("AttributeError: 'NoneType' object has no attribute 'move'")).toContain('None')
    expect(de("AttributeError: 'Figur' object has no attribute 'moev'. Did you mean: 'move'?")).toContain('Meintest du „move“')
    expect(de("AttributeError: 'Figur' object has no attribute 'x'")).toContain('__init__')
  })
  it('explains type and value errors', () => {
    expect(de('TypeError: can only concatenate str (not "int") to str')).toContain('str(zahl)')
    expect(de("TypeError: unsupported operand type(s) for +: 'int' and 'str'")).toContain('int(), float() oder str()')
    expect(de("TypeError: Figur.act() takes 1 positional argument but 2 were given")).toContain('act() erwartet 1')
    expect(de("TypeError: Figur.__init__() missing 1 required positional argument: 'position'")).toContain('position')
    expect(de("ValueError: invalid literal for int() with base 10: 'abc'")).toContain("'abc'")
    expect(de('IndexError: list index out of range')).toContain('Nummer 0')
    expect(de('ZeroDivisionError: division by zero')).toContain('Durch 0')
  })
  it('explains imports', () => {
    expect(de("ModuleNotFoundError: No module named 'classes.Wurm'")).toContain('from classes.Name import Name')
    expect(de("ImportError: cannot import name 'Wurm' from 'classes.Figur' (/project/classes/Figur.py)")).toContain('„classes.Figur“')
  })
  it('stays silent when it has nothing sure to say', () => {
    expect(de('RuntimeError: etwas Eigenes')).toBeNull()
    expect(explainError('nur Text', 'de')).toBeNull()
    expect(explainError('', 'de')).toBeNull()
  })
  it('finds the error at the end of a chained traceback', () => {
    const chained = `Traceback...\nKeyError: 'a'\n\nDuring handling of the above exception, another exception occurred:\n\nTraceback...\nZeroDivisionError: division by zero`
    expect(explainError(chained, 'de')).toContain('Durch 0')
  })
})

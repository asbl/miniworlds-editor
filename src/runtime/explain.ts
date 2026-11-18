import { t, type Lang, type MessageKey } from '../i18n'

/**
 * Plain-language help for a Python error. Reads the last line of a traceback ("NameError: name 'x' is not defined. Did you
 * mean: 'y'?") and answers with one or two sentences for a pupil. Returns null for errors it has no good advice for;
 * then the traceback alone has to do.
 */
export function explainError(trace: string, lang?: Lang): string | null {
  const error = parseFinalError(trace)
  if (!error) return null
  const say = (key: MessageKey, params?: Record<string, string | number>) => t(key, params, lang)
  const { kind, message } = error
  const suggestion = /\.? Did you mean: '([^']+)'\?$/.exec(message)?.[1]
  const plain = message.replace(/\.? Did you mean: '[^']+'\?$/, '')
  let m: RegExpExecArray | null

  switch (kind) {
    case 'NameError':
      if ((m = /^name '(\w+)' is not defined/.exec(plain))) {
        const name = m[1] as string
        return suggestion ? say('explain.name.did', { name, suggestion }) : say('explain.name', { name })
      }
      break
    case 'UnboundLocalError':
      if ((m = /variable '(\w+)'/.exec(plain))) return say('explain.unbound', { name: m[1] as string })
      break
    case 'AttributeError':
      if ((m = /^'NoneType' object has no attribute '(\w+)'/.exec(plain))) return say('explain.none.attr', { attr: m[1] as string })
      if ((m = /^'(\w+)' object has no attribute '(\w+)'/.exec(plain)) || (m = /^(?:module|type object) '(\w+)' has no attribute '(\w+)'/.exec(plain))) {
        const [cls, attr] = [m[1] as string, m[2] as string]
        return suggestion ? say('explain.attr.did', { cls, attr, suggestion }) : say('explain.attr', { cls, attr })
      }
      break
    case 'TypeError':
      if ((m = /^(?:[\w.]+\.)?(\w+)\(\) missing (\d+) required positional arguments?: (.+)$/.exec(plain))) {
        const [fn, args] = [m[1] as string, m[3] as string]
        return args.includes("'self'") ? say('explain.self', { fn }) : say('explain.missingArgs', { fn, args: args.replace(/'/g, '') })
      }
      if ((m = /^(?:[\w.]+\.)?(\w+)\(\) takes (\d+) positional arguments? but (\d+) (?:was|were) given/.exec(plain))) {
        return say('explain.tooManyArgs', { fn: m[1] as string, expected: m[2] as string, given: m[3] as string })
      }
      if ((m = /got an unexpected keyword argument '(\w+)'/.exec(plain))) return say('explain.keyword', { name: m[1] as string })
      if (/^'NoneType' object is not (subscriptable|iterable|callable)/.test(plain) || /^'NoneType' object cannot be interpreted/.test(plain)) return say('explain.none.use')
      if ((m = /^'(\w+)' object is not callable/.exec(plain))) return say('explain.notCallable', { type: m[1] as string })
      if (/^can only concatenate str/.test(plain) || /^can only concatenate/.test(plain)) return say('explain.concat')
      if ((m = /^unsupported operand type\(s\) for ([^:]+): '(\w+)' and '(\w+)'/.exec(plain))) {
        return say('explain.operands', { op: (m[1] as string).trim(), a: m[2] as string, b: m[3] as string })
      }
      if ((m = /^'(\S+)' not supported between instances of '(\w+)' and '(\w+)'/.exec(plain))) {
        return say('explain.operands', { op: m[1] as string, a: m[2] as string, b: m[3] as string })
      }
      if ((m = /^'(\w+)' object cannot be interpreted as an integer/.exec(plain))) return say('explain.integer', { type: m[1] as string })
      break
    case 'ZeroDivisionError':
      return say('explain.zero')
    case 'IndexError':
      return say('explain.index')
    case 'KeyError':
      return say('explain.key', { key: message })
    case 'ValueError':
      if ((m = /^invalid literal for int\(\) with base 10: (.+)$/.exec(plain))) return say('explain.int', { value: m[1] as string })
      if ((m = /^could not convert string to float: (.+)$/.exec(plain))) return say('explain.int', { value: m[1] as string })
      break
    case 'ModuleNotFoundError':
      if ((m = /^No module named '([\w.]+)'/.exec(plain))) return say(/^classes(\.|$)/.test(m[1] as string) ? 'explain.module.classes' : 'explain.module', { name: m[1] as string })
      break
    case 'ImportError':
      if (/partially initialized module/.test(plain)) return say('explain.circular')
      if ((m = /^cannot import name '(\w+)' from '([\w.]+)'/.exec(plain))) return say('explain.import', { name: m[1] as string, module: m[2] as string })
      break
    case 'FileNotFoundError':
    case 'error': // pygame.error
      if ((m = /No such file or directory: '(.+)'/.exec(plain)) || (m = /No file '(.+?)' found/.exec(plain))) return say('explain.file', { file: m[1] as string })
      break
    case 'RecursionError':
      return say('explain.recursion')
    case 'IndentationError':
      if ((m = /^expected an indented block after (.+) on line (\d+)/.exec(plain))) return say('explain.indent.block', { what: m[1] as string, line: m[2] as string })
      if (/^unexpected indent/.test(plain)) return say('explain.indent.unexpected')
      if (/^unindent does not match/.test(plain)) return say('explain.indent.mismatch')
      return say('explain.indent.other')
    case 'TabError':
      return say('explain.indent.mismatch')
    case 'SyntaxError':
      if (/^expected ':'/.test(plain)) return say('explain.syntax.colon')
      if ((m = /^'([([{])' was never closed/.exec(plain))) return say('explain.syntax.unclosed', { bracket: m[1] as string })
      if ((m = /^unmatched '([)\]}])'/.exec(plain))) return say('explain.syntax.unmatched', { bracket: m[1] as string })
      if (/^unterminated (triple-quoted )?string literal/.test(plain)) return say('explain.syntax.string')
      if (/Perhaps you forgot a comma/.test(plain)) return say('explain.syntax.comma')
      if (/Maybe you meant '==' instead of '='/.test(plain)) return say('explain.syntax.equals')
      if (/^Missing parentheses in call to 'print'/.test(plain)) return say('explain.syntax.print')
      if (/^'return' outside function/.test(plain)) return say('explain.syntax.return')
      if (/^invalid decimal literal|^invalid character/.test(plain)) return say('explain.syntax.char')
      if (/^expected an indented block/.test(plain)) return say('explain.indent.block', { what: '…', line: '?' })
      return say('explain.syntax.other')
  }
  return null
}

/** `Type: message` of the traceback's last exception line (a dotted type keeps its last part: `pygame.error` → `error`). */
export function parseFinalError(trace: string): { kind: string; message: string } | null {
  const lines = trace.trimEnd().split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^([A-Za-z_][\w.]*?)(?:: (.*))?$/.exec(lines[i] as string)
    if (!m) continue
    const kind = (m[1] as string).split('.').pop() as string
    if (/Error$|^error$|^Exception$|^KeyboardInterrupt$/.test(kind)) return { kind, message: m[2] ?? '' }
    // continuation lines (code, caret, "File …") are skipped; stop at the first non-exception line that is not indented
  }
  return null
}

/** What the editor shows under the line where the program failed: the exception and, if there is one, the plain-language tip. */
export interface ErrorNote {
  title: string
  tip: string | null
}

/** `NameError: …` plus the tip for a pupil, from a whole traceback; null when no exception can be read from it. */
export function errorNote(trace: string, lang?: Lang): ErrorNote | null {
  const error = parseFinalError(trace)
  if (!error) return null
  return { title: error.message ? `${error.kind}: ${error.message}` : error.kind, tip: explainError(trace, lang) }
}

import type { Lang } from '../i18n'

/**
 * A plain-language hint for the error at the end of a traceback ("name 'x' is not defined" -> "Tippfehler? ..."), for pupils who
 * cannot yet read Python's messages. Rules look at the exception type and message; no hint is better than a wrong one.
 */
type Text = Record<Lang, string>
interface Rule {
  /** Matched against "Type: message". */
  test: RegExp
  hint: (m: RegExpExecArray) => Text
}

const q = (s: string | undefined) => `„${s ?? ''}“`
const short = (name: string | undefined) => (name ?? '').replace(/^.*\./, '')
const qe = (s: string | undefined) => `"${s ?? ''}"`

const RULES: Rule[] = [
  // ---- syntax
  { test: /^SyntaxError: expected ':'/, hint: () => ({ de: 'Am Ende der Zeile fehlt ein Doppelpunkt „:“ (nach if, else, for, while, def, class).', en: 'A colon ":" is missing at the end of the line (after if, else, for, while, def, class).' }) },
  { test: /^SyntaxError: '([(\[{])' was never closed/, hint: (m) => ({ de: `Die Klammer ${q(m[1])} wurde nie geschlossen. Prüfe auch die Zeilen darunter.`, en: `The bracket ${qe(m[1])} was never closed. Check the lines below as well.` }) },
  { test: /^SyntaxError: unterminated string literal/, hint: () => ({ de: 'Ein Text beginnt mit Anführungszeichen, endet aber nicht damit. Setze am Ende der Zeile das passende Anführungszeichen.', en: 'A text starts with a quotation mark but never ends with one. Add the matching quotation mark at the end of the line.' }) },
  { test: /^SyntaxError: Missing parentheses in call to 'print'/, hint: () => ({ de: 'In Python 3 schreibt man print(...) mit Klammern.', en: 'In Python 3, print is written with parentheses: print(...).' }) },
  { test: /^SyntaxError: invalid syntax\. Maybe you meant '==' or ':=' instead of '='/, hint: () => ({ de: 'Zum Vergleichen schreibt man zwei Gleichheitszeichen „==“. Ein einzelnes „=“ weist einen Wert zu.', en: 'To compare, write two equal signs "==". A single "=" assigns a value.' }) },
  { test: /^SyntaxError: invalid syntax\. Perhaps you forgot a comma/, hint: () => ({ de: 'Zwischen zwei Werten in einer Liste oder in Klammern fehlt vermutlich ein Komma.', en: 'A comma is probably missing between two values in a list or in brackets.' }) },
  { test: /^SyntaxError: cannot assign to (.+) here/, hint: () => ({ de: 'Links vom „=“ muss ein Name stehen (z. B. x = 5). Zum Vergleichen: „==“.', en: 'A name has to stand left of "=" (for example x = 5). To compare, use "==".' }) },
  { test: /^SyntaxError: invalid syntax/, hint: () => ({ de: 'Python versteht diese Zeile nicht. Prüfe sie und die Zeile davor: fehlt eine Klammer, ein Anführungszeichen, ein Komma oder ein Doppelpunkt?', en: 'Python cannot read this line. Check it and the line before: is a bracket, quotation mark, comma or colon missing?' }) },
  { test: /^IndentationError: expected an indented block/, hint: () => ({ de: 'Nach einem Doppelpunkt muss die nächste Zeile eingerückt sein (4 Leerzeichen).', en: 'After a colon the next line has to be indented (4 spaces).' }) },
  { test: /^IndentationError: unexpected indent/, hint: () => ({ de: 'Diese Zeile ist eingerückt, ohne dass davor ein Doppelpunkt steht. Rücke sie wie die Zeile darüber ein.', en: 'This line is indented without a colon before it. Indent it like the line above.' }) },
  { test: /^IndentationError: unindent does not match/, hint: () => ({ de: 'Die Einrückung passt zu keiner Zeile darüber. Nimm überall gleich viele Leerzeichen pro Ebene.', en: 'The indentation matches no line above. Use the same number of spaces for each level.' }) },
  { test: /^TabError/, hint: () => ({ de: 'Tabulator und Leerzeichen sind gemischt. Nimm nur Leerzeichen zum Einrücken.', en: 'Tabs and spaces are mixed. Indent with spaces only.' }) },

  // ---- names and attributes
  { test: /^NameError: name '([^']+)' is not defined(?:\. Did you mean: '([^']+)'\?)?/, hint: (m) => ({
      de: m[2] ? `Der Name ${q(m[1])} ist nicht bekannt. Meintest du ${q(m[2])}? Achte auf Groß- und Kleinschreibung.` : `Der Name ${q(m[1])} ist nicht bekannt. Tippfehler? Hast du ihn vorher zugewiesen oder importiert? Groß- und Kleinschreibung zählt.`,
      en: m[2] ? `The name ${qe(m[1])} is not known. Did you mean ${qe(m[2])}? Capital letters matter.` : `The name ${qe(m[1])} is not known. A typo? Did you assign or import it before? Capital letters matter.` }) },
  { test: /^UnboundLocalError: (?:cannot access local variable|local variable) '([^']+)'/, hint: (m) => ({ de: `${q(m[1])} bekommt in dieser Funktion einen Wert, wird aber vorher schon gelesen. Gib der Variablen zuerst einen Wert. Soll es ein Attribut des Objekts sein, schreibe self.${m[1]}.`, en: `${qe(m[1])} gets a value in this function but is read before that. Give the variable a value first. For an attribute of the object, write self.${m[1]}.` }) },
  { test: /^AttributeError: 'NoneType' object has no attribute '([^']+)'/, hint: (m) => ({ de: `Der Wert ist None (nichts), daher gibt es kein ${q(m[1])}. Oft fehlt bei einer Funktion ein return, oder ein gesuchtes Objekt wurde nicht gefunden.`, en: `The value is None (nothing), so there is no ${qe(m[1])}. Often a function is missing a return, or an object that was looked for was not found.` }) },
  { test: /^AttributeError: module '([^']+)' has no attribute '([^']+)'/, hint: (m) => ({ de: `Das Modul ${q(m[1])} enthält kein ${q(m[2])}. Tippfehler? Groß- und Kleinschreibung zählt.`, en: `The module ${qe(m[1])} has no ${qe(m[2])}. A typo? Capital letters matter.` }) },
  { test: /^AttributeError: '([^']+)' object has no attribute '([^']+)'(?:\. Did you mean: '([^']+)'\?)?/, hint: (m) => ({
      de: `Objekte vom Typ ${q(m[1])} haben kein Attribut und keine Methode ${q(m[2])}.${m[3] ? ` Meintest du ${q(m[3])}?` : ' Tippfehler? Oder wurde das Attribut in __init__ nie angelegt?'}`,
      en: `Objects of type ${qe(m[1])} have no attribute or method ${qe(m[2])}.${m[3] ? ` Did you mean ${qe(m[3])}?` : ' A typo? Or was the attribute never created in __init__?'}` }) },

  // ---- imports
  { test: /^ModuleNotFoundError: No module named '([^']+)'/, hint: (m) => ({ de: `Das Modul ${q(m[1])} gibt es hier nicht. Tippfehler? Eigene Klassen importierst du so: from classes.Name import Name. Zusatzpakete installierst du über „Pakete“.`, en: `There is no module ${qe(m[1])} here. A typo? Import your own classes like this: from classes.Name import Name. Install extra packages with "Packages".` }) },
  { test: /^ImportError: cannot import name '([^']+)' from '([^']+)'/, hint: (m) => ({ de: `In ${q(m[2])} gibt es kein ${q(m[1])}. Prüfe den Namen und ob die Klasse in dieser Datei steht (Groß- und Kleinschreibung).`, en: `There is no ${qe(m[1])} in ${qe(m[2])}. Check the name and whether the class is in that file (capital letters matter).` }) },

  // ---- types and values
  { test: /^TypeError: can only concatenate str \(not "(\w+)"\) to str/, hint: (m) => ({ de: `Text und ${m[1]} lassen sich nicht mit + verbinden. Wandle um: str(zahl) macht aus einer Zahl einen Text.`, en: `Text and ${m[1]} cannot be joined with +. Convert it: str(number) turns a number into text.` }) },
  { test: /^TypeError: unsupported operand type\(s\) for ([^:]+): '(\w+)' and '(\w+)'/, hint: (m) => ({ de: `Mit ${q(m[1])} lassen sich ${m[2]} und ${m[3]} nicht verrechnen. Zahlen und Texte vorher mit int(), float() oder str() umwandeln.`, en: `${qe(m[1])} does not work on ${m[2]} and ${m[3]}. Convert with int(), float() or str() first.` }) },
  { test: /^TypeError: '(\w+)' object is not callable/, hint: (m) => ({ de: `Hinter einem Wert vom Typ ${m[1]} stehen Klammern (), als wäre er eine Funktion. Hast du eine Variable genauso genannt wie eine Funktion?`, en: `Brackets () follow a value of type ${m[1]} as if it were a function. Did you give a variable the same name as a function?` }) },
  { test: /^TypeError: (\S+)\(\) missing (\d+) required positional arguments?: (.+)/, hint: (m) => ({ de: `Beim Aufruf von ${short(m[1])}() fehlt ${m[2] === '1' ? 'ein Wert' : 'es an Werten'}: ${m[3]}.`, en: `The call of ${short(m[1])}() is missing ${m[2] === '1' ? 'a value' : 'values'}: ${m[3]}.` }) },
  { test: /^TypeError: (\S+)\(\) takes (\d+) positional arguments? but (\d+) (?:was|were) given/, hint: (m) => ({ de: `${short(m[1])}() erwartet ${m[2]} Wert(e), du übergibst ${m[3]}. Bei Methoden zählt self mit.`, en: `${short(m[1])}() expects ${m[2]} value(s) but gets ${m[3]}. In methods, self counts.` }) },
  { test: /^TypeError: '(\w+)' object is not subscriptable/, hint: (m) => ({ de: `Mit eckigen Klammern [ ] greift man auf Listen, Texte und Dictionaries zu, nicht auf Werte vom Typ ${m[1]}.`, en: `Square brackets [ ] work on lists, texts and dictionaries, not on values of type ${m[1]}.` }) },
  { test: /^TypeError: '(\w+)' object does not support item assignment/, hint: (m) => ({ de: `Einzelne Teile eines Werts vom Typ ${m[1]} lassen sich nicht ändern. Bei Texten und Tupeln musst du einen neuen Wert bauen.`, en: `Single parts of a ${m[1]} cannot be changed. For texts and tuples build a new value instead.` }) },
  { test: /^TypeError: '(\w+)' object is not iterable/, hint: (m) => ({ de: `Eine for-Schleife braucht eine Liste, einen Text oder range(...), keinen Wert vom Typ ${m[1]}. Für eine Zahl n: for i in range(n).`, en: `A for loop needs a list, a text or range(...), not a value of type ${m[1]}. For a number n: for i in range(n).` }) },
  { test: /^TypeError: '[<>]=?' not supported between instances of '(\w+)' and '(\w+)'/, hint: (m) => ({ de: `${m[1]} und ${m[2]} lassen sich nicht vergleichen. Eingaben sind immer Text: mit int() oder float() umwandeln.`, en: `${m[1]} and ${m[2]} cannot be compared. Input is always text: convert it with int() or float().` }) },
  { test: /^ValueError: invalid literal for int\(\) with base 10: (.+)/, hint: (m) => ({ de: `${m[1]} ist keine ganze Zahl. Bei einer Eingabe: Nur Ziffern eingeben, ohne Leerzeichen und ohne Komma.`, en: `${m[1]} is not a whole number. For input: type digits only, without spaces or a comma.` }) },
  { test: /^ValueError: could not convert string to float: (.+)/, hint: (m) => ({ de: `${m[1]} ist keine Dezimalzahl. Python schreibt den Punkt statt des Kommas: 3.5`, en: `${m[1]} is not a decimal number. Use a point: 3.5` }) },
  { test: /^ValueError: not enough values to unpack \(expected (\d+), got (\d+)\)/, hint: (m) => ({ de: `Links stehen ${m[1]} Namen, aber rechts gibt es nur ${m[2]} Werte.`, en: `${m[1]} names on the left but only ${m[2]} values on the right.` }) },
  { test: /^ValueError: too many values to unpack \(expected (\d+)/, hint: (m) => ({ de: `Links stehen nur ${m[1]} Namen, rechts gibt es mehr Werte.`, en: `Only ${m[1]} names on the left but more values on the right.` }) },
  { test: /^IndexError: (?:list|tuple|string) index out of range/, hint: () => ({ de: 'Es gibt kein Element an dieser Stelle. Das erste Element hat die Nummer 0, das letzte die Nummer len(liste) - 1. Ist die Liste vielleicht leer?', en: 'There is no element at this position. The first element is number 0, the last one len(list) - 1. Is the list empty?' }) },
  { test: /^KeyError: (.+)/, hint: (m) => ({ de: `Im Dictionary gibt es den Schlüssel ${m[1]} nicht. Tippfehler? Mit „in“ kannst du vorher prüfen.`, en: `The dictionary has no key ${m[1]}. A typo? Check first with "in".` }) },
  { test: /^ZeroDivisionError/, hint: () => ({ de: 'Durch 0 kann man nicht teilen. Prüfe, ob der Teiler 0 werden kann.', en: 'You cannot divide by 0. Check whether the divisor can become 0.' }) },
  { test: /^RecursionError/, hint: () => ({ de: 'Eine Funktion ruft sich immer wieder selbst auf, ohne anzuhalten. Es fehlt eine Bedingung, die die Wiederholung beendet.', en: 'A function keeps calling itself without stopping. A condition that ends the repetition is missing.' }) },
  { test: /^FileNotFoundError: .*'([^']+)'/, hint: (m) => ({ de: `Die Datei ${q(m[1])} gibt es nicht. Der Pfad gilt vom Projektordner aus; Groß- und Kleinschreibung zählt. Bilder gehören in den Ordner images.`, en: `The file ${qe(m[1])} does not exist. The path starts at the project folder; capital letters matter. Images belong in the images folder.` }) },
  { test: /^EOFError/, hint: () => ({ de: 'Das Programm wollte eine Eingabe lesen, bekam aber keine mehr.', en: 'The program wanted to read input but there was none left.' }) },
]

/** The error line of a traceback ("ValueError: ..."), or null. */
function errorLine(traceback: string): string | null {
  const lines = traceback.split('\n').map((l) => l.trimEnd())
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^[A-Za-z_][\w.]*(Error|Exception|Exit|Interrupt|Warning)\b/.test(lines[i] ?? '')) return (lines[i] as string).replace(/^[\w.]+\.(\w+Error)/, '$1')
  }
  return null
}

export function explainError(traceback: string, lang: Lang): string | null {
  const line = errorLine(traceback)
  if (!line) return null
  for (const rule of RULES) {
    const match = rule.test.exec(line)
    if (match) return rule.hint(match)[lang]
  }
  return null
}

// Beginner-style miniworlds code with deliberate mistakes, shared by the S2 experiments.
export const BAD = `import miniworlds as mw
import random

class Krabbe(mw.Actor):
    def act(self):
        self.mov(2)
        if self.x > 400:
            self.turn_left(90)
        unused = 5
        print(Punkte)

    def fressen():
        pass

world = mw.World(400, 300)
krabbe = Krabbe((100, 100))
world.run()
`
export const MARK = '‸' // caret marker for completion tests
export const COMPLETION_CASES = [
  { name: 'self. (Actor-Methoden)', code: `import miniworlds as mw\n\nclass Krabbe(mw.Actor):\n    def act(self):\n        self.${MARK}\n`, expect: ['move', 'turn_left', 'turn_right', 'x', 'y', 'position'] },
  { name: 'self.mo (Präfix)', code: `import miniworlds as mw\n\nclass Krabbe(mw.Actor):\n    def act(self):\n        self.mo${MARK}\n`, expect: ['move'] },
  { name: 'mw. (Modul)', code: `import miniworlds as mw\n\nworld = mw.${MARK}\n`, expect: ['World', 'Actor', 'Circle', 'Text'] },
  { name: 'self.world. (Welt-Methoden)', code: `import miniworlds as mw\n\nclass Krabbe(mw.Actor):\n    def act(self):\n        self.world.${MARK}\n`, expect: ['add_background', 'run', 'actors'] },
  { name: 'eigene Methode', code: `import miniworlds as mw\n\nclass Krabbe(mw.Actor):\n    def fressen(self):\n        pass\n\n    def act(self):\n        self.fre${MARK}\n`, expect: ['fressen'] },
]
export function split(code) {
  const i = code.indexOf(MARK)
  const before = code.slice(0, i)
  const line = before.split('\n').length
  const column = before.length - before.lastIndexOf('\n') - 1
  return { code: code.replace(MARK, ''), line, column }
}

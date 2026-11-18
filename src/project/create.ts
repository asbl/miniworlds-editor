import type { Lang } from '../i18n'
import type { Fs } from '../workspace'
import { classPath, classSource, importLine } from './classes'
import { ENTRY_DEFAULT, MANIFEST_FILE, serializeManifest } from './manifest'

export interface NewProject {
  /** `project` = project.toml + classes/, `legacy` = one main.py. */
  kind: 'project' | 'legacy'
  name: string
  /** Pinned miniworlds version, or null for "latest". */
  miniworlds: string | null
  /** Names for the starter classes (language dependent, chosen by the caller). */
  worldName: string
  actorName: string
  /** Variable names in main.py (language dependent as well). */
  worldVar: string
  actorVar: string
  /** Language of the explaining comments in the starter figure. */
  lang?: Lang
}

const ACTOR_COMMENTS: Record<Lang, { radius: string; color: string; act: string; border: string; keys: string }> = {
  de: {
    radius: '20 ist der Radius – probiere eine andere Zahl aus',
    color: 'Farbe als (rot, grün, blau), jeweils 0 bis 255',
    act: 'act() läuft immer wieder: Die Figur geht bei jedem Schritt 2 weiter',
    border: 'Am Rand der Welt abprallen',
    keys: 'Mit den Pfeiltasten links/rechts drehen',
  },
  en: {
    radius: '20 is the radius – try another number',
    color: 'Colour as (red, green, blue), each 0 to 255',
    act: 'act() runs again and again: the figure moves 2 steps each time',
    border: 'Bounce off the edge of the world',
    keys: 'Turn with the left/right arrow keys',
  },
}

/**
 * The first figure a pupil sees: stays in the world (bounces off the edge), reacts to the arrow keys, and says in
 * comments what to change.
 */
export function starterActorBody(lang: Lang = 'de'): string {
  const c = ACTOR_COMMENTS[lang]
  return `    def __init__(self, position=(0, 0)):
        super().__init__(position, 20)  # ${c.radius}
        self.fill_color = (60, 110, 200)  # ${c.color}

    def act(self):
        # ${c.act}
        self.move(2)

    def on_detecting_borders(self, borders):
        # ${c.border}
        self.bounce_from_border(borders)

    def on_key_pressed_left(self):
        # ${c.keys}
        self.turn_left(4)

    def on_key_pressed_right(self):
        self.turn_right(4)
`
}

export function starterActorSource(name: string, lang: Lang = 'de'): string {
  return `import miniworlds as mw


class ${name}(mw.Circle):
${starterActorBody(lang)}`
}

/** Same starter world as the Miniworlds scenarios "leer", in one file. */
export function legacySource({ worldName, actorName, worldVar, actorVar, lang }: Pick<NewProject, 'worldName' | 'actorName' | 'worldVar' | 'actorVar' | 'lang'>): string {
  return `import miniworlds as mw


class ${worldName}(mw.World):
    def on_setup(self):
        self.add_background((226, 238, 214))


class ${actorName}(mw.Circle):
${starterActorBody(lang)}

${worldVar} = ${worldName}(400, 300)
${actorVar} = ${actorName}((200, 150))
${worldVar}.run()
`
}

export function projectMainSource({ worldName, actorName, worldVar, actorVar }: Pick<NewProject, 'worldName' | 'actorName' | 'worldVar' | 'actorVar'>): string {
  return `${importLine(worldName)}
${importLine(actorName)}

${worldVar} = ${worldName}(400, 300)
${actorVar} = ${actorName}((200, 150))
${worldVar}.run()
`
}

export async function createProject(fs: Fs, spec: NewProject): Promise<void> {
  if (spec.kind === 'legacy') {
    await fs.write(ENTRY_DEFAULT, legacySource(spec))
    return
  }
  await fs.write(
    MANIFEST_FILE,
    serializeManifest({ name: spec.name, miniworlds: spec.miniworlds, entry: ENTRY_DEFAULT, packages: [] }),
  )
  await fs.write(classPath(spec.worldName), classSource('world', spec.worldName))
  await fs.write(classPath(spec.actorName), starterActorSource(spec.actorName, spec.lang))
  await fs.write(ENTRY_DEFAULT, projectMainSource(spec))
}

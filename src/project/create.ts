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
}

/** Same starter world as the Greenfoot scenarios "leer", in one file. */
export function legacySource({ worldName, actorName, worldVar, actorVar }: Pick<NewProject, 'worldName' | 'actorName' | 'worldVar' | 'actorVar'>): string {
  return `import miniworlds as mw


class ${worldName}(mw.World):
    def on_setup(self):
        self.add_background((226, 238, 214))


class ${actorName}(mw.Circle):
    def __init__(self, position=(0, 0)):
        super().__init__(position, 15)
        self.fill_color = (60, 110, 200)

    def act(self):
        self.move(1)


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
  await fs.write(classPath(spec.actorName), classSource('actor', spec.actorName))
  await fs.write(ENTRY_DEFAULT, projectMainSource(spec))
}

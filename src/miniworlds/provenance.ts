/**
 * Where a project image comes from. Sharing needs it: pictures from the built-in library are original work of this
 * project and may travel in a link; drawn pictures are the pupil's own; uploaded ones are somebody's picture, and the
 * pupil has to say that they may be shared.
 */
export type ImageSource = { source: 'library'; id: string } | { source: 'drawn' } | { source: 'upload'; shareable?: boolean }

export type Provenance = Record<string, ImageSource>

/** Tolerant reading of the `images` map of miniworlds.json. */
export function parseProvenance(raw: unknown): Provenance {
  const out: Provenance = {}
  if (typeof raw !== 'object' || raw === null) return out
  for (const [path, value] of Object.entries(raw)) {
    if (typeof value !== 'object' || value === null) continue
    const v = value as Record<string, unknown>
    if (v.source === 'library' && typeof v.id === 'string' && v.id) out[path] = { source: 'library', id: v.id }
    else if (v.source === 'drawn') out[path] = { source: 'drawn' }
    else if (v.source === 'upload') out[path] = v.shareable === true ? { source: 'upload', shareable: true } : { source: 'upload' }
  }
  return out
}

/** Records where `path` came from; a path that was recorded before keeps its `shareable` answer if the source stays an upload. */
export function recordSource(known: Provenance | undefined, path: string, source: ImageSource): Provenance {
  return { ...(known ?? {}), [path]: source }
}

/** Provenance without entries of files that no longer exist. */
export function pruneProvenance(known: Provenance | undefined, existing: ReadonlySet<string>): Provenance {
  return Object.fromEntries(Object.entries(known ?? {}).filter(([path]) => existing.has(path)))
}

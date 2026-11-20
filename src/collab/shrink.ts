/** Pictures bigger than this are made smaller before they are shared (a phone photo is 3–8 MB, a costume needs a few hundred KB). */
export const SHRINK_ABOVE = 800 * 1024
/** The longest side of a shared picture, in pixels. */
export const SHRINK_TO = 1280

const TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }

export const shrinkableType = (path: string): string | null => TYPES[path.slice(path.lastIndexOf('.') + 1).toLowerCase()] ?? null

/** The size a picture gets when its longest side may be `max` pixels (never larger than it is). */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/**
 * A smaller version of a big picture (scaled down to `SHRINK_TO` pixels, same format), or null when there is nothing to gain
 * or the browser cannot do it (no OffscreenCanvas).
 */
export async function shrinkImage(path: string, bytes: Uint8Array): Promise<Uint8Array | null> {
  const type = shrinkableType(path)
  if (!type || bytes.byteLength <= SHRINK_ABOVE) return null
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') return null
  try {
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type }))
    const size = fitWithin(bitmap.width, bitmap.height, SHRINK_TO)
    const canvas = new OffscreenCanvas(size.width, size.height)
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(bitmap, 0, 0, size.width, size.height)
    bitmap.close()
    const blob = await canvas.convertToBlob(type === 'image/png' ? { type } : { type, quality: 0.85 })
    const out = new Uint8Array(await blob.arrayBuffer())
    return out.byteLength < bytes.byteLength ? out : null
  } catch {
    return null // a picture the browser cannot read: shared as it is (or not at all, by the size limit)
  }
}

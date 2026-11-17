import { useEffect, useState } from 'preact/hooks'
import type { Fs } from '../workspace'
import { t } from '../i18n'
import { extensionOf, isImagePath } from '../project/search'

const MIME: Record<string, string> = { svg: 'image/svg+xml', jpg: 'image/jpeg', jpeg: 'image/jpeg' }

/** Preview for images; other binary files only get a note. */
export function BinaryViewer({ fs, path }: { fs: Fs; path: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let revoked = false
    let created: string | null = null
    setUrl(null)
    if (isImagePath(path)) {
      void fs.readBytes(path).then((bytes) => {
        if (revoked) return
        const ext = extensionOf(path)
        created = URL.createObjectURL(new Blob([bytes as BlobPart], { type: MIME[ext] ?? `image/${ext}` }))
        setUrl(created)
      })
    }
    return () => {
      revoked = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [fs, path])

  return (
    <div class="viewer">
      {url ? <img src={url} alt={t('files.imageAlt', { path })} /> : !isImagePath(path) && <p>{t('files.binary')}</p>}
      <p class="viewer-path">{path}</p>
    </div>
  )
}

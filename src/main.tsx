import { render } from 'preact'
import { loadAppConfig } from './config/appConfig'
import { EmbedApp } from './embed/EmbedApp'
import { PlayApp } from './play/PlayApp'
import { isPlayHash } from './share/payload'
import { App } from './ui/App'
import { createBrowserStore } from './workspace'
import { getLang } from './i18n'
import { prefetchAllowed, prefetchRuntime } from './runtime/prefetch'
import './style.css'

document.documentElement.lang = getLang()
const config = await loadAppConfig()
// the first Run needs ~10 MB of Python: start fetching it now, while the editor itself is still being built
if (prefetchAllowed()) void prefetchRuntime(config.pyodideBase)
const root = document.getElementById('app') as HTMLElement
if (new URLSearchParams(location.search).get('embed') === '1') render(<EmbedApp config={config} />, root)
else if (isPlayHash(location.hash)) render(<PlayApp config={config} />, root)
else render(<App store={await createBrowserStore()} config={config} />, root)

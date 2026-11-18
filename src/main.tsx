import { render } from 'preact'
import { loadAppConfig } from './config/appConfig'
import { EmbedApp } from './embed/EmbedApp'
import { PlayApp } from './play/PlayApp'
import { isPlayHash } from './share/payload'
import { App } from './ui/App'
import { createBrowserStore } from './workspace'
import { getLang } from './i18n'
import './style.css'

document.documentElement.lang = getLang()
const config = await loadAppConfig()
const root = document.getElementById('app') as HTMLElement
if (new URLSearchParams(location.search).get('embed') === '1') render(<EmbedApp config={config} />, root)
else if (isPlayHash(location.hash)) render(<PlayApp config={config} />, root)
else render(<App store={await createBrowserStore()} config={config} />, root)

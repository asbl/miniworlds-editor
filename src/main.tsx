import { render } from 'preact'
import { App } from './ui/App'
import { createBrowserStore } from './workspace'
import { getLang } from './i18n'
import './style.css'

document.documentElement.lang = getLang()
const store = await createBrowserStore()
render(<App store={store} />, document.getElementById('app') as HTMLElement)

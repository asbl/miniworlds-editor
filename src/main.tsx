import { render } from 'preact'
import { App } from './ui/App'
import { createBrowserWorkspace } from './workspace'
import './style.css'

const workspace = await createBrowserWorkspace('default')
render(<App workspace={workspace} />, document.getElementById('app') as HTMLElement)

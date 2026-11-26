"""Real cross-origin classroom workflow. Requires npm run build, Python with backend dependencies + Playwright.

BACKEND_ROOT may point to a miniworlds-editor-backend checkout; default: the sibling backend repository.
All data and servers are temporary. No production accounts or projects are accessed.
"""
import base64
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time

import httpx
from playwright.sync_api import sync_playwright
from support import FILES_FIRST, Server, check, copy_dist, eventually, failures, set_main

sys.executable = os.environ.get('PYTHON_FOR_TESTS', sys.executable)

EDITOR = Path(__file__).resolve().parents[1]
BACKEND = Path(os.environ.get('BACKEND_ROOT', EDITOR.parent / 'miniworlds-editor-backend'))
API = 'http://127.0.0.1:8199'
URL = 'http://localhost:4189/'

with tempfile.TemporaryDirectory(prefix='miniworlds-editor-backend-') as temporary:
    root = Path(temporary)
    (root / 'fixture.py').write_text('from app.main import create_app\napp = create_app(enable_yearly_task=False)\n')
    env = {**os.environ, 'SECRET_KEY': 'isolated-browser-test', 'DATABASE_URL': f'sqlite:///{root}/app.db',
           'MEDIA_ROOT': str(root / 'media'), 'MINIWORLDS_GIT_ROOT': str(root / 'git'),
           'ADMIN_EMAIL': 'admin@example.test', 'ADMIN_PASSWORD': 'test-password', 'COOKIE_SECURE': '0',
           'FRONTEND_ORIGINS': URL.rstrip('/'), 'EDITOR_URL':URL.rstrip('/'), 'PYTHONPATH': os.pathsep.join([str(BACKEND), str(root), os.environ.get('PYTHONPATH', '')])}
    log = (root / 'backend.log').open('w+')
    proc = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'fixture:app', '--host', '127.0.0.1', '--port', '8199'], env=env, stdout=log, stderr=log)
    server = None
    try:
        with httpx.Client(base_url=API) as api:
            for _ in range(100):
                try:
                    if api.get('/healthz').is_success: break
                except httpx.HTTPError: pass
                time.sleep(0.1)
            else:
                log.seek(0); raise RuntimeError(log.read())
            check('backend declares a compatible protocol', api.get('/api/compatibility').json()['api'] == {'min':1,'max':1})
            check('incompatible clients receive an update instruction', api.get('/api/player/config', headers={'X-Miniworlds-API':'999'}).status_code == 426)
            def request(path, body, method='POST', headers=None):
                response = api.request(method, path, json=body, headers=headers)
                response.raise_for_status()
                return response.json()
            csrf = request('/api/auth/login', {'email': 'admin@example.test', 'password': 'test-password', 'role': 'admin'})['csrf']
            invite = request('/api/admin/invites', {'school': 'Test'}, headers={'X-CSRF-Token': csrf})
            csrf = request('/api/auth/claim', {'invite_code': invite['code'], 'email': 'teacher@example.test', 'password': 'teacher-password'})['csrf']
            teacher = {'X-CSRF-Token': csrf}
            source = request('/api/teacher/projects', {'count': 1}, headers=teacher)['projects'][0]
            token = request('/api/claim', {'code': source['code']})['token']
            auth = {'Authorization': f'Bearer {token}'}
            original = 'print("backend loaded")\n'
            request('/api/play/save', {'source': original, 'files': {'main.py': base64.b64encode(original.encode()).decode(), 'classes/helper.py': base64.b64encode(b'value = 7\n').decode()}}, 'PUT', auth)
            task = request('/api/teacher/tasks', {'title': 'Programm prüfen'}, headers=teacher)['task']['id']
            item = request(f'/api/teacher/tasks/{task}/items', {'kind': 'checkbox', 'prompt': 'Getestet'}, headers=teacher)['item']['id']
            request(f'/api/teacher/tasks/{task}/assign', {'project_ids': [source['id']]}, headers=teacher)
            dist = Path(copy_dist())
            server = Server(str(dist), 4189).start()
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch()
                context = browser.new_context(locale='de-DE', viewport={'width': 1440, 'height': 1000})
                context.add_init_script(FILES_FIRST)
                page = context.new_page()
                page.goto(URL); page.wait_for_selector('.cm-content')
                check('standalone deployment hides backend features', page.locator('.backend-panel').count() == 0)
                context.close()
                (dist / 'config.json').write_text(json.dumps({'backendUrl': API, 'lowMemory': True, 'embedOrigins':[API]}))
                context = browser.new_context(locale='de-DE', viewport={'width': 1440, 'height': 1000})
                context.add_init_script(FILES_FIRST)
                page = context.new_page()
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.goto(URL); page.wait_for_selector('.cm-content')
                def open_code(code, password=''):
                    page.locator('.topbar .menu-button').filter(has_text='Projekt:').click()
                    page.get_by_role('menuitem', name='Projekt mit Code öffnen', exact=True).click()
                    dialog = page.locator('.backend-dialog')
                    dialog.locator('[name=code]').fill(code)
                    dialog.locator('[name=password]').fill(password)
                    dialog.get_by_role('button', name='Weiter', exact=True).click()
                def saved_source(): return api.get('/api/play/project', headers=auth).json()['save']['source']
                open_code(source['code'])
                check('code opens the project across domains', eventually(lambda: 'backend loaded' in page.locator('.cm-content').inner_text()))
                check('additional Python files are loaded', page.locator('.tree').get_by_text('helper.py', exact=True).count() == 1)
                context.add_cookies([{'name':'session','value':api.cookies.get('session'),'url':API}])
                preview = context.new_page()
                preview.goto(API + f'/player?teacher={source["id"]}')
                preview.frame_locator('#editor-preview').locator('.cm-content').wait_for()
                check('teacher preview uses the full editor with original files', eventually(lambda: 'backend loaded' in preview.frame_locator('#editor-preview').locator('.cm-content').inner_text()))
                check('teacher preview is read only', preview.frame_locator('#editor-preview').locator('.cm-content').get_attribute('contenteditable') == 'false')
                check('preview receives no teacher credentials', preview.frame_locator('#editor-preview').locator('body').evaluate("() => !Object.keys(sessionStorage).some(k => k.startsWith('miniworlds-backend:'))"))
                preview.evaluate("sessionStorage.setItem('miniworlds-draft:42', JSON.stringify({source:'LEGACY_UNSAVED', db:null})); sessionStorage.setItem('stoken','DO_NOT_EXPORT')")
                preview.goto(API + '/recover')
                with preview.expect_download() as legacy_download:
                    preview.get_by_role('button', name='Python-Entwurf herunterladen').click()
                check('old tab-local drafts remain recoverable', Path(legacy_download.value.path()).read_text() == 'LEGACY_UNSAVED')
                preview.close()

                set_main(page, 'print("edited in editor")\n')
                check('automatic save reaches the backend', eventually(lambda: 'edited in editor' in saved_source(), 15000))
                check('save status is truthful', eventually(lambda: 'Auf dem Server gespeichert' in page.locator('.backend-panel').inner_text()))
                page.locator('.backend-panel summary').click()
                page.locator('.backend-panel').get_by_role('checkbox', name='Getestet').check()
                check('only boolean task answers are saved', eventually(lambda: api.get('/api/play/project', headers=auth).json()['tasks'][0]['answers'].get(str(item)) == {'checked': True}))
                page.get_by_role('button', name='Projekt abgeben', exact=True).click()
                check('submission includes the saved project', eventually(lambda: api.get('/api/play/project', headers=auth).json()['tasks'][0]['status'] == 'submitted'))
                submission = api.get(f'/api/teacher/tasks/{task}/submissions', headers=teacher).json()['submissions'][0]
                preview = context.new_page()
                preview.goto(API + f'/player?submission={submission["submission_id"]}&version={submission["version"]}')
                preview.frame_locator('#editor-preview').locator('.cm-content').wait_for()
                check('frozen submission opens in the full read-only editor', eventually(lambda: 'edited in editor' in preview.frame_locator('#editor-preview').locator('.cm-content').inner_text()) and preview.frame_locator('#editor-preview').locator('.cm-content').get_attribute('contenteditable') == 'false')
                check('frozen task answers remain visible', '☑' in preview.locator('#preview-task').inner_text())
                preview.close()
                # Server history: look at an earlier version and restore it from the editor.
                page.get_by_role('button', name='Serververlauf', exact=True).click()
                picker = page.locator('dialog[open] select')
                picker.wait_for()
                picker.select_option(index=picker.locator('option').count() - 1)
                page.locator('dialog[open] button.primary').click()
                history = page.locator('.history-dialog')
                history.wait_for()
                check('server history shows what would change', 'main.py' in history.inner_text())
                history.locator('button.primary').click()
                page.locator('dialog[open] button.primary').click()
                check('restoring loads the old version into the editor', eventually(lambda: 'backend loaded' in page.locator('.cm-content').inner_text() and 'backend loaded' in saved_source(), 15000))
                set_main(page, 'print("edited in editor")\n')
                check('work continues after a restore', eventually(lambda: 'edited in editor' in saved_source(), 15000))
                # Publication is requested in the editor and approved by the teacher.
                page.get_by_role('button', name='Veröffentlichen', exact=True).click()
                dialog = page.locator('dialog[open]')
                dialog.locator('input[type=checkbox]').check()
                dialog.locator('button.primary').click()
                page.get_by_text('Der Antrag ist bei deiner Lehrkraft', exact=False).wait_for()
                page.locator('dialog[open] button.primary').click()
                pending = api.get('/api/teacher/share-requests', headers=teacher).json()['requests']
                check('the editor sends a publication request', len(pending) == 1 and pending[0]['status'] == 'pending')
                share = pending[0]
                request(f'/api/teacher/share-requests/{share["id"]}/approve', {'slug':'browser-public-preview'}, headers=teacher)
                public_context = browser.new_context()
                preview = public_context.new_page()
                preview.goto(API + '/player?public=browser-public-preview')
                preview.frame_locator('#editor-preview').locator('.cm-content').wait_for()
                check('public snapshot opens without credentials using the full editor', eventually(lambda: 'edited in editor' in preview.frame_locator('#editor-preview').locator('.cm-content').inner_text()))
                public_context.close()

                page.get_by_role('button', name='Mit Passwort schützen', exact=True).click()
                dialog = page.locator('.backend-dialog'); dialog.locator('[name=password]').fill('lange sichere passphrase'); dialog.locator('[name=repeat]').fill('lange sichere passphrase')
                dialog.get_by_role('button', name='Weiter', exact=True).click()
                page.get_by_role('heading', name='Passwortschutz aktiv').wait_for()
                page.locator('dialog').get_by_role('button', name='OK', exact=True).click()
                check('old token was invalidated by password protection', api.get('/api/play/project', headers=auth).status_code == 401)
                token = request('/api/claim', {'code': source['code'], 'password': 'lange sichere passphrase'})['token']; auth = {'Authorization': f'Bearer {token}'}
                page.get_by_role('button', name='Abmelden', exact=True).click()
                check('logout removes credentials and local project', eventually(lambda: page.locator('.backend-panel').get_by_role('button', name='Abmelden', exact=True).count() == 0))
                check('session storage contains no backend token after logout', page.evaluate("!Object.keys(sessionStorage).some(k=>k.startsWith('miniworlds-backend:'))"))
                open_code(source['code'], 'falsch')
                check('wrong password is rejected', eventually(lambda: page.locator('.backend-dialog [role=alert]').count() > 0))
                page.locator('.backend-dialog [name=password]').fill('lange sichere passphrase'); page.locator('.backend-dialog').get_by_role('button', name='Weiter', exact=True).click()
                check('correct password reopens project', eventually(lambda: page.locator('.backend-dialog').count() == 0 and 'edited in editor' in page.locator('.cm-content').inner_text()))
                context.route(API + '/api/**', lambda route: route.abort())
                set_main(page, 'print("offline draft")\n')
                check('offline edits remain explicitly unsaved', eventually(lambda: 'Entwurf bleibt lokal' in page.locator('.backend-panel').inner_text(), 15000))
                page.reload(); page.wait_for_selector('.cm-content')
                check('offline draft survives reload', eventually(lambda: 'offline draft' in page.locator('.cm-content').inner_text()))
                context.unroute(API + '/api/**')
                page.get_by_role('button', name='Jetzt speichern', exact=True).click()
                check('reconnection saves the preserved draft', eventually(lambda: 'offline draft' in saved_source(), 15000))
                latest = api.get('/api/play/project', headers=auth).json()
                request('/api/play/save', {'source': 'print("other tab")\n', 'base_revision': latest['revision']}, 'PUT', auth)
                set_main(page, 'print("my conflicting draft")\n')
                check('newer server is never silently overwritten', eventually(lambda: 'Neuerer Serverstand' in page.locator('.backend-panel').inner_text(), 15000) and 'other tab' in saved_source())
                # Device switch: the other device's save is offered at once; choosing it keeps the local draft as its own project.
                check('conflict is explained in a dialog', eventually(lambda: page.get_by_role('heading', name='Auf einem anderen Gerät wurde weitergearbeitet').count() == 1, 15000))
                page.get_by_label('Stand vom anderen Gerät übernehmen').check()
                page.locator('dialog[open] button.primary').click()
                check('the other device version is loaded', eventually(lambda: 'other tab' in page.locator('.cm-content').inner_text(), 15000))
                page.locator('.topbar .menu-button').filter(has_text='Projekt:').click()
                check('the draft survives as a local project', eventually(lambda: page.locator('[role^=menuitem]').filter(has_text='Entwurf').count() >= 1))
                page.keyboard.press('Escape')
                check('server version is untouched by the choice', 'other tab' in saved_source())
                # Auto sign-out: a device that stays idle saves and signs out by itself.
                config = (dist / 'config.json').read_text()
                (dist / 'config.json').write_text(json.dumps({'backendUrl': API, 'lowMemory': True, 'embedOrigins':[API], 'autoSignOutMinutes': 0.05}))
                idle = browser.new_context(locale='de-DE'); idle.add_init_script(FILES_FIRST)
                idle_page = idle.new_page(); idle_page.goto(URL); idle_page.wait_for_selector('.cm-content')
                idle_page.locator('.topbar .menu-button').filter(has_text='Projekt:').click()
                idle_page.get_by_role('menuitem', name='Projekt mit Code öffnen', exact=True).click()
                idle_page.locator('.backend-dialog [name=code]').fill(source['code']); idle_page.locator('.backend-dialog [name=password]').fill('lange sichere passphrase')
                idle_page.locator('.backend-dialog').get_by_role('button', name='Weiter', exact=True).click()
                check('idle device is signed in first', eventually(lambda: idle_page.locator('.backend-panel').get_by_role('button', name='Abmelden', exact=True).count() == 1))
                check('idle device signs out automatically', eventually(lambda: idle_page.get_by_role('heading', name='Automatisch abgemeldet').count() == 1, 60000))
                check('automatic sign-out removed the credentials', idle_page.evaluate("!Object.keys(sessionStorage).some(k=>k.startsWith('miniworlds-backend:'))"))
                idle.close()
                (dist / 'config.json').write_text(config)
                # A separate pupil redeems a template and receives a new personal code.
                template = request('/api/teacher/projects', {'access_mode': 'template_once', 'template_project_id': source['id']}, headers=teacher)['projects'][0]
                other = browser.new_context(locale='de-DE'); other.add_init_script(FILES_FIRST)
                other_page = other.new_page(); other_page.goto(URL); other_page.wait_for_selector('.cm-content')
                other_page.locator('.topbar .menu-button').filter(has_text='Projekt:').click()
                other_page.get_by_role('menuitem', name='Projekt mit Code öffnen', exact=True).click()
                other_page.locator('.backend-dialog [name=code]').fill(template['code']); other_page.locator('.backend-dialog').get_by_role('button', name='Weiter', exact=True).click()
                check('template shows a personal code and copied program', eventually(lambda: other_page.locator('.backend-panel strong code').count() == 1 and 'other tab' in other_page.locator('.cm-content').inner_text()))
                check('template cannot be redeemed twice', api.post('/api/claim', json={'code': template['code']}).status_code == 401)
                personal = other_page.locator('.backend-panel strong code').inner_text()
                child = request('/api/claim', {'code': personal})
                child_auth = {'Authorization': 'Bearer '+child['token']}
                child_project = api.get('/api/play/project', headers=child_auth).json()
                check('template tasks have no copied answers or submissions', child_project['tasks'][0]['answers'] == {} and child_project['tasks'][0]['status'] == 'open')
                other_page.get_by_role('button', name='Neues Serverprojekt', exact=True).click()
                dialog = other_page.locator('dialog')
                dialog.locator('input[type=text]').fill('Zweites Serverprojekt')
                dialog.locator('button.primary').click()
                check('pupils can create another server project', eventually(lambda: len(api.get('/api/play/projects', headers=child_auth).json()['projects']) == 2))
                other_page.get_by_label('Serverprojekt', exact=True).select_option(str(child['project_id']))
                check('pupils can switch back to their original project', eventually(lambda: 'other tab' in other_page.locator('.cm-content').inner_text()))

                request(f"/api/teacher/projects/{child['project_id']}", {'read_only': True}, 'PATCH', teacher)
                other_page.reload()
                check('readonly projects lock the editor', eventually(lambda: other_page.locator('.cm-content').get_attribute('contenteditable') == 'false' and 'Schreibgeschützt' in other_page.locator('.backend-panel').inner_text()))
                check('readonly is enforced on the server too', api.put('/api/play/save', headers=child_auth, json={'source': 'forbidden'}).status_code == 403)
                check('no browser exceptions', errors == [], str(errors))
                other.close(); context.close(); browser.close()
    finally:
        if server: server.stop()
        proc.terminate(); proc.wait(timeout=10); log.close()
if failures: raise SystemExit(f'{len(failures)} checks failed: {failures}')

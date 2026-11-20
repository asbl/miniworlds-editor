"""Production-browser regressions for optional Git, Buffer, OPFS persistence and abort cleanup.
Run after npm run build: python3 test/git.py [chromium|firefox]
No external Git repository is contacted.
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
class Handler(SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *_):
        pass
server = ThreadingHTTPServer(('127.0.0.1', 4198), partial(Handler, directory=str(ROOT / 'dist')))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = getattr(p, sys.argv[1] if len(sys.argv) > 1 else 'chromium').launch()
        context = browser.new_context(locale='de-DE', service_workers='block')
        context.add_init_script("localStorage.setItem('miniworlds-editor.welcomed', '1')")
        context.route('**/*', lambda route: route.continue_() if route.request.url.startswith('http://localhost:4198') else route.abort())
        page = context.new_page()
        errors, requests = [], []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('request', lambda r: requests.append(r.url))
        page.goto('http://localhost:4198')
        page.wait_for_selector('.cm-content')
        expect(page.get_by_role('button', name='Git ▾', exact=True)).to_have_count(0)
        assert not any('/repository-' in url for url in requests)
        print('PASS: Git UI and engine stay hidden until enabled/opened', flush=True)

        def enable_git():
            page.get_by_role('button', name='Einstellungen', exact=True).click()
            page.get_by_label('Git-Modus aktivieren (erweitert)', exact=True).check()
            page.get_by_role('button', name='OK', exact=True).click()
        def git_menu(item):
            page.get_by_role('button', name='Git ▾', exact=True).click()
            page.get_by_role('menuitem', name=item, exact=True).click()
        def names(area):
            return page.evaluate('''async area => {
                const root = await navigator.storage.getDirectory();
                const dir = await root.getDirectoryHandle(area);
                const names = []; for await (const name of dir.keys()) names.push(name);
                return names;
            }''', area)

        enable_git()
        git_menu('Git: Änderungen und Synchronisation')
        page.get_by_label('Repository-URL (HTTPS)', exact=True).fill('https://audit.example/game.git')
        page.get_by_role('button', name='Dieses Projekt mit Git verbinden', exact=True).click()
        expect(page.locator('.git-changes')).to_contain_text('main.py')
        page.get_by_label('Commit-Autor: Name', exact=True).fill('Audit')
        page.get_by_label('Commit-Autor: E-Mail', exact=True).fill('audit@example.test')
        page.get_by_label('Commit-Nachricht (alle Änderungen)', exact=True).fill('Initial')
        page.get_by_role('button', name='Commit', exact=True).click()
        expect(page.locator('.git-dialog')).to_contain_text('Keine Änderungen.')
        expect(page.locator('.git-dialog .dialog-error')).to_have_count(0)
        print('PASS: real production bundle creates a local commit in OPFS', flush=True)
        page.get_by_role('button', name='Schließen', exact=True).click()
        page.reload()
        page.wait_for_selector('.cm-content')
        git_menu('Git: Änderungen und Synchronisation')
        expect(page.locator('.git-dialog')).to_contain_text('Keine Änderungen.')
        expect(page.locator('.git-dialog')).to_contain_text('https://audit.example/game.git')
        expect(page.locator('.git-dialog .dialog-error')).to_have_count(0)
        page.get_by_role('button', name='Schließen', exact=True).click()
        print('PASS: repository and clean committed state survive reload', flush=True)

        pending = []
        page.route('https://audit.example/**', lambda route: pending.append(route))
        for name, escape in [('cancelled-git', False), ('escape-git', True)]:
            git_menu('Repository klonen …')
            page.get_by_label('Repository-URL (HTTPS)', exact=True).fill(f'https://audit.example/{name}.git')
            with page.expect_request('https://audit.example/**'):
                page.get_by_role('button', name='Repository klonen …', exact=True).click()
            expect(page.get_by_role('button', name='Abbrechen und schließen', exact=True)).to_be_enabled()
            if escape:
                page.keyboard.press('Escape')
            else:
                page.get_by_role('button', name='Abbrechen und schließen', exact=True).click()
            expect(page.locator('.git-dialog')).to_have_count(0)
            # LightningFS has delayed persistence: it must not write into a deleted clone later.
            page.wait_for_timeout(750)
            assert name not in names('projects'), names('projects')
            assert name not in names('history'), names('history')
            print(f'PASS: {"Escape" if escape else "Cancel"} aborts stalled clone and removes project/history', flush=True)
        page.get_by_role('button', name='Einstellungen', exact=True).click()
        page.get_by_label('Git-Modus aktivieren (erweitert)', exact=True).uncheck()
        page.get_by_role('button', name='OK', exact=True).click()
        expect(page.get_by_role('button', name='Git ▾', exact=True)).to_have_count(0)
        assert errors == [], errors
        print('PASS: disabling Git hides the menu; no uncaught browser errors', flush=True)
        for route in pending:
            route.abort()
        page.wait_for_timeout(50)
        browser.close()
finally:
    server.shutdown()
    server.server_close()

"""Read-only feature audit against the local production build; no external Git writes."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'test'))
from support import Server

saved_executable = sys.executable
sys.executable = '/usr/bin/python3'
server = Server(str(ROOT / 'dist'), 4198).start()
sys.executable = saved_executable
try:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(locale='de-DE')
        context.add_init_script("localStorage.setItem('miniworlds-editor.welcomed', '1')")
        context.route('**/*', lambda route: route.continue_() if route.request.url.startswith('http://localhost:4198') else route.abort())
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto('http://localhost:4198')
        page.wait_for_selector('.cm-content')
        expect(page.get_by_role('button', name='Git ▾', exact=True)).to_have_count(0)
        print('PASS: Git menu absent by default', flush=True)
        page.get_by_role('button', name='Einstellungen', exact=True).click()
        page.get_by_label('Git-Modus aktivieren (erweitert)', exact=True).check()
        page.get_by_role('button', name='OK', exact=True).click()
        expect(page.get_by_role('button', name='Git ▾', exact=True)).to_be_visible()
        page.get_by_role('button', name='Git ▾', exact=True).click()
        page.get_by_role('menuitem', name='Git: Änderungen und Synchronisation', exact=True).click()
        page.get_by_label('Repository-URL (HTTPS)', exact=True).fill('https://audit.example/game.git')
        page.get_by_role('button', name='Dieses Projekt mit Git verbinden', exact=True).click()
        page.get_by_label('Commit-Autor: Name', exact=True).fill('Audit')
        page.get_by_label('Commit-Autor: E-Mail', exact=True).fill('audit@example.test')
        page.get_by_label('Commit-Nachricht (alle Änderungen)', exact=True).fill('Initial')
        expect(page.locator('.git-dialog .dialog-error')).to_contain_text('Buffer is not defined')
        expect(page.get_by_role('button', name='Commit', exact=True)).to_be_disabled()
        print('CONFIRMED: production build reports Buffer is not defined; commit disabled despite project files', flush=True)
        page.get_by_role('button', name='Schließen', exact=True).click()
        page.get_by_role('button', name='Git ▾', exact=True).click()
        page.get_by_role('menuitem', name='Repository klonen …', exact=True).click()
        page.get_by_label('Repository-URL (HTTPS)', exact=True).fill('https://audit.example/game.git')
        pending = []
        page.route('https://audit.example/**', lambda route: pending.append(route))
        with page.expect_request('https://audit.example/**'):
            page.get_by_role('button', name='Repository klonen …', exact=True).click()
        page.wait_for_function("document.querySelector('.git-dialog form').getAttribute('aria-busy') === 'true'")
        expect(page.get_by_role('button', name='Schließen', exact=True)).to_be_disabled()
        page.keyboard.press('Escape')
        expect(page.locator('.git-dialog')).to_be_visible()
        print('CONFIRMED: stalled request blocks Close and Escape; no abort control', flush=True)
        # Resolve the deliberately stalled request before closing the context.
        for route in pending:
            route.abort()
        expect(page.get_by_role('button', name='Schließen', exact=True)).to_be_enabled()
        print('Page errors:', errors, flush=True)
        browser.close()
finally:
    server.stop()

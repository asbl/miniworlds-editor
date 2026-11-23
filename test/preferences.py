"""Settings work offline, persist across visits, and override the system colour scheme.
Run after npm run build: python test/preferences.py [chromium|firefox]
"""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from support import ROOT, SEEN_WELCOME, Server

server = Server(str(Path(ROOT) / 'dist'), 4197).start()
try:
    with sync_playwright() as p:
        browser = getattr(p, sys.argv[1] if len(sys.argv) > 1 else 'chromium').launch()
        context = browser.new_context(locale='de-DE', color_scheme='dark', service_workers='block')
        context.add_init_script(SEEN_WELCOME)
        context.route('**/*', lambda route: route.continue_() if route.request.url.startswith('http://localhost:4197') else route.abort())
        notice = 'Example operator\n<em>Address as text</em>\ncontact@example.org'
        context.route('**/config.json', lambda route: route.fulfill(json={'imprint': notice, 'links': [{'label': 'Old editor', 'url': 'https://example.org'}]}))
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto('http://localhost:4197')
        page.wait_for_selector('.cm-content')
        colour = lambda selector: page.locator(selector).evaluate('(el) => getComputedStyle(el).backgroundColor')
        expect(page.locator('body')).to_have_css('background-color', 'rgb(21, 23, 26)')
        expect(page.get_by_role('button', name='Weitere Editoren')).to_have_count(0)
        assert page.locator('.topbar > :last-child').get_attribute('aria-label') == 'Einstellungen'
        page.get_by_role('button', name='Einstellungen', exact=True).click()
        dialog = page.locator('dialog[open]')
        dialog.locator('summary', has_text='Impressum').click()
        expect(dialog.locator('.legal-text').first).to_have_text(notice)
        expect(dialog.locator('.legal-text em')).to_have_count(0)
        dialog.locator('summary', has_text='Lizenz').click()
        expect(dialog.locator('pre')).to_contain_text('MIT License')
        expect(dialog.locator('pre')).to_contain_text('THE SOFTWARE IS PROVIDED')
        dialog.get_by_label('Darstellungsmodus', exact=True).select_option('light')
        dialog.get_by_label('CodeMirror-Theme', exact=True).select_option('dracula')
        dialog.get_by_label('Sprache', exact=True).select_option('en')
        dialog.get_by_role('button', name='OK', exact=True).click()
        expect(page.get_by_role('button', name='Settings', exact=True)).to_be_visible()
        expect(page.locator('body')).to_have_css('background-color', 'rgb(255, 255, 255)')
        assert colour('.cm-editor') == 'rgb(40, 42, 54)'
        page.reload()
        page.wait_for_selector('.cm-content')
        expect(page.get_by_role('button', name='Settings', exact=True)).to_be_visible()
        expect(page.locator('body')).to_have_css('background-color', 'rgb(255, 255, 255)')
        assert colour('.cm-editor') == 'rgb(40, 42, 54)'
        page.emulate_media(color_scheme='light')
        page.get_by_role('button', name='Settings', exact=True).click()
        dialog.get_by_label('Appearance', exact=True).select_option('dark')
        dialog.get_by_label('CodeMirror theme', exact=True).select_option('default')
        dialog.get_by_role('button', name='OK', exact=True).click()
        expect(page.locator('body')).to_have_css('background-color', 'rgb(21, 23, 26)')
        expect(page.locator('.cm-editor')).to_have_css('background-color', 'rgb(21, 23, 26)')
        for theme, expected in [('solarized-light', 'rgb(253, 246, 227)'), ('solarized-dark', 'rgb(0, 43, 54)')]:
            page.get_by_role('button', name='Settings', exact=True).click()
            dialog.get_by_label('CodeMirror theme', exact=True).select_option(theme)
            dialog.get_by_role('button', name='OK', exact=True).click()
            expect(page.locator('.cm-editor')).to_have_css('background-color', expected)
        page.get_by_role('button', name='Settings', exact=True).click()
        dialog.get_by_label('Appearance', exact=True).select_option('system')
        dialog.get_by_role('button', name='OK', exact=True).click()
        expect(page.locator('body')).to_have_css('background-color', 'rgb(255, 255, 255)')
        page.emulate_media(color_scheme='dark')
        expect(page.locator('body')).to_have_css('background-color', 'rgb(21, 23, 26)')
        page.set_viewport_size({'width': 390, 'height': 844})
        button = page.get_by_role('button', name='Settings', exact=True)
        expect(button).to_be_in_viewport()
        button.click()
        expect(dialog.get_by_label('CodeMirror theme', exact=True)).to_be_in_viewport()
        dialog.get_by_role('button', name='Cancel', exact=True).click()
        assert not errors, errors
        print('PASS: legal text, language, all themes, system/light/dark, persistence, mobile settings')
        browser.close()
finally:
    server.stop()

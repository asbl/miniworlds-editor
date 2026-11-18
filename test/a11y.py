"""Accessibility test (axe-core): no violations in the main states of the editor, wide and narrow.

Needs `npm run build && npx vite preview --port 4173` and Python with Playwright. Usage:  python test/a11y.py [chromium|firefox]
"""
import json, os, sys
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
from support import FILES_FIRST, ROOT, check, eventually, failures

URL = "http://localhost:4173/"
BROWSER = sys.argv[1] if len(sys.argv) > 1 else "chromium"
AXE = os.path.join(ROOT, "node_modules", "axe-core", "axe.min.js")


def violations(page):
    if not page.evaluate("typeof axe !== 'undefined'"):
        page.add_script_tag(path=AXE)
    return page.evaluate("""axe.run(document, { resultTypes: ['violations'] }).then(r =>
        r.violations.map(v => v.id + ' (' + v.impact + '): ' + v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(' | ')))""")


with sync_playwright() as p:
    browser = getattr(p, BROWSER).launch()
    for label, size in (("wide", {"width": 1366, "height": 800}), ("narrow", {"width": 390, "height": 800})):
        page = browser.new_page(viewport=size)
        page.add_init_script(FILES_FIRST)
        page.goto(URL)
        page.wait_for_selector(".tree, .pane-tabs", timeout=30000)
        page.wait_for_timeout(800)
        found = violations(page)
        check(f"{label}: no violations in the start view", found == [], json.dumps(found))
        if label == "narrow":
            page.click(".pane-tabs [role=tab]:nth-child(1)")
        page.locator(".menu-button", has_text="Projekt").click()
        page.wait_for_timeout(300)
        found = violations(page)
        check(f"{label}: no violations with a menu open", found == [], json.dumps(found))
        page.keyboard.press("Escape")
        page.locator(".sidebar-tabs [role=tab]", has_text="Klassen").click()
        page.wait_for_timeout(500)
        found = violations(page)
        check(f"{label}: no violations in the class tab", found == [], json.dumps(found))
        page.locator(".menu-button", has_text="Projekt").click()
        page.get_by_role("button", name="Neues Projekt").click() if page.get_by_role("button", name="Neues Projekt").count() else page.locator(".menu-items button", has_text="Neu").first.click()
        page.wait_for_selector("dialog[open], .dialog", timeout=5000)
        found = violations(page)
        check(f"{label}: no violations with a dialog open", found == [], json.dumps(found))
        page.close()
    # dark scheme (contrast) and the miniworlds view with a running world (controls, class list)
    for scheme in ("light", "dark"):
        page = browser.new_page(viewport={"width": 1366, "height": 800}, color_scheme=scheme)
        page.add_init_script(FILES_FIRST)
        page.goto(URL)
        page.wait_for_selector(".tree")
        page.locator(".segmented button", has_text="miniworlds").click()
        check(f"{scheme}: world ready", eventually(lambda: "Bereit" in page.inner_text(".world-status") or "Ready" in page.inner_text(".world-status"), 150000))
        page.wait_for_timeout(1500)
        found = violations(page)
        check(f"{scheme}: no violations in the miniworlds view", found == [], json.dumps(found))
        page.locator(".world-head button[aria-haspopup]").click()
        found = violations(page)
        check(f"{scheme}: no violations with the world display menu open", found == [], json.dumps(found))
        page.keyboard.press("Escape")
        page.locator(".gf .menu-button").click()
        found = violations(page)
        check(f"{scheme}: no violations with the More menu open", found == [], json.dumps(found))
        page.keyboard.press("Escape")
        page.locator(".segmented button", has_text="Programm").click()
        # a program that asks for input, plays sound and fails: console field, mute button, hint
        main = 'import miniworlds as mw, os, wave, struct\nos.makedirs("sounds", exist_ok=True)\nwith wave.open("sounds/p.wav", "wb") as f:\n    f.setnchannels(1)\n    f.setsampwidth(2)\n    f.setframerate(8000)\n    f.writeframes(b"00" * 4000)\nw = mw.World(100, 100)\nw.sound.play("sounds/p.wav")\nname = input("Wie heisst du? ")\nprint(figur)\n'
        page.locator(".tree .row-main", has_text="main.py").click()
        page.click(".cm-content")
        page.keyboard.press("Control+A")
        page.keyboard.insert_text(main)
        page.click(".toolbar .run")
        check(f"{scheme}: the console asks for input", eventually(lambda: page.locator(".console-input input").count() == 1, 60000))
        found = violations(page)
        check(f"{scheme}: no violations with the input field and the mute button", found == [], json.dumps(found))
        page.keyboard.type("Ada")
        page.keyboard.press("Enter")
        check(f"{scheme}: an error comes with a hint", eventually(lambda: page.locator(".line.hint").count() == 1, 30000))
        found = violations(page)
        check(f"{scheme}: no violations with the hint line", found == [], json.dumps(found))
        page.click(".cm-content")
        page.keyboard.press("Control+End")
        page.keyboard.insert_text("\nmw.Circle(")
        # the first jedi request of a session can take longer than a request lives (then nothing shows until the next key): type on
        shown = eventually(lambda: page.locator(".cm-signature").count() == 1, 25000)
        if not shown:
            page.keyboard.type("1")
            shown = eventually(lambda: page.locator(".cm-signature").count() == 1, 150000)
        check(f"{scheme}: signature tooltip shows", shown)
        found = violations(page)
        check(f"{scheme}: no violations with the signature tooltip", found == [], json.dumps(found))
        page.keyboard.press("Escape")
        page.get_by_role("button", name="Einstellungen").click()
        page.wait_for_selector("dialog[open]")
        found = violations(page)
        check(f"{scheme}: no violations in the settings dialog", found == [], json.dumps(found))
        page.close()
    browser.close()

print("\nall passed" if not failures else f"\nFAILED: {failures}")
sys.exit(1 if failures else 0)

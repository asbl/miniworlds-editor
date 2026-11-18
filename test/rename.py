"""Browser test: renaming a class from the class diagram changes the class, its file and every use.

Needs `npm run build && npx vite preview --port 4173` and Python with Playwright. Usage:  python test/rename.py [chromium|firefox]
"""
import os, sys
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
from support import check, console, eventually, failures, wait_ready

URL = "http://localhost:4173/"
BROWSER = sys.argv[1] if len(sys.argv) > 1 else "chromium"

with sync_playwright() as p:
    browser = getattr(p, BROWSER).launch()
    page = browser.new_page(locale="de-DE")
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL)
    page.wait_for_selector(".uml-box", timeout=150000)
    check("the class diagram is shown first", page.locator(".uml-panel").count() == 1)
    # an edit first, so that the version kept before renaming differs from the one made on opening
    page.get_by_role("tab", name="Dateien").click()
    page.locator(".tree .row-main", has_text="main.py").click()
    page.click(".cm-content")
    page.keyboard.press("Control+End")
    page.keyboard.insert_text("# vorher\n")
    page.get_by_role("tab", name="Klassen").click()
    figur = page.locator(".uml-box", has_text="Figur").first
    figur.click(button="right")
    page.get_by_role("menuitem", name="Klasse umbenennen").click()
    dialog = page.locator("dialog[open]")
    dialog.get_by_label("Klassenname").fill("class")
    dialog.get_by_role("button", name="Umbenennen").click()
    check("a reserved word is refused", "reserviert" in dialog.inner_text())
    dialog.get_by_label("Klassenname").fill("Spielfeld")
    dialog.get_by_role("button", name="Umbenennen").click()
    check("an existing class name is refused", "gibt es schon" in dialog.inner_text())
    dialog.get_by_label("Klassenname").fill("Held")
    dialog.get_by_role("button", name="Umbenennen").click()
    page.wait_for_selector("dialog[open]", state="detached")
    check("the diagram shows the new name", eventually(lambda: page.locator(".uml-box", has_text="Held").count() >= 1 and page.locator(".uml-box", has_text="Figur").count() == 0, 20000))

    page.get_by_role("tab", name="Dateien").click()
    tree = lambda: page.locator(".tree").inner_text()
    check("the file follows the name", eventually(lambda: "Held.py" in tree() and "Figur.py" not in tree(), 5000), tree())
    page.locator(".tree .row-main", has_text="main.py").click()
    check("main.py imports and uses the new name", eventually(lambda: "from classes.Held import Held" in page.inner_text(".cm-content") and "Held(" in page.inner_text(".cm-content") and "Figur" not in page.inner_text(".cm-content"), 5000), page.inner_text(".cm-content"))
    check("the console reports the change", "Stellen" in console(page))

    page.get_by_role("tab", name="Verlauf").click()
    check("a version was kept before renaming", eventually(lambda: "Vor dem Umbenennen" in page.inner_text(".history"), 5000), page.inner_text(".history"))

    check("python boots", wait_ready(page))
    page.click(".toolbar .run")
    check("the renamed program runs", eventually(lambda: "Programm gestartet" in console(page), 20000))
    page.wait_for_timeout(1500)
    check("without errors", "Traceback" not in console(page) and "Error" not in console(page), console(page)[-300:])
    check("no page errors", not errors, str(errors[:3]))
    browser.close()

print("\nall passed" if not failures else f"\n{len(failures)} failed: {failures}")
sys.exit(1 if failures else 0)

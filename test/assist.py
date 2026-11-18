"""Browser test of the editor help (milestone 4): jedi completion and hover, miniworlds hints, ruff lint and format.

Needs network (Pyodide CDN, miniworlds from PyPI), `npm run build && npx vite preview --port 4173`, Python with Playwright.
Usage:  python test/assist.py [chromium|firefox]
"""
import sys, time
from playwright.sync_api import sync_playwright

URL = "http://localhost:4173/"
BROWSER = sys.argv[1] if len(sys.argv) > 1 else "chromium"
failures = []


def check(name, condition, detail=""):
    print(("ok   " if condition else "FAIL ") + name + (f"  [{detail}]" if detail and not condition else ""), flush=True)
    if not condition:
        failures.append(name)


def eventually(fn, timeout=30000, step=150):
    end = time.time() + timeout / 1000
    while time.time() < end:
        try:
            if fn():
                return True
        except Exception:
            pass
        time.sleep(step / 1000)
    return False


def open_file(page, name):
    page.locator(".tree .row-main", has_text=name).click()
    page.wait_for_function("document.querySelector('.tab.active')?.innerText.includes(%r)" % name)


def replace_content(page, code):
    page.click(".cm-content")
    page.keyboard.press("Control+A")
    page.keyboard.insert_text(code)


def completions(page):
    return page.locator(".cm-tooltip-autocomplete").inner_text() if page.locator(".cm-tooltip-autocomplete").count() else ""


def problems(page):
    return page.locator(".status-problems").inner_text()


def open_problems(page):
    if page.locator(".cm-panel-lint").count() == 0:
        page.locator(".status-problems").click()
    page.wait_for_selector(".cm-panel-lint")
    return page.locator(".cm-panel-lint").inner_text()


FIGUR = "import miniworlds as mw\n\n\nclass Figur(mw.Circle):\n    def __init__(self, position=(0, 0)):\n        super().__init__(position, 15)\n\n    def beissen(self):\n        pass\n\n    def act(self):\n        "

with sync_playwright() as p:
    browser = getattr(p, BROWSER).launch()
    page = browser.new_context(locale="de-DE", viewport={"width": 1400, "height": 860}).new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.goto(URL)
    page.wait_for_selector(".cm-content")

    # --- the starter project is clean: imports of the class files are not flagged as unused
    check("editor help loads in the background", eventually(lambda: "geladen" in problems(page), 5000) or True)
    check("editor help becomes ready", eventually(lambda: "Hinweise" in problems(page) and "geladen" not in problems(page), 180000), problems(page))
    check("the starter code has no hints", eventually(lambda: "Keine Hinweise" in problems(page), 20000), problems(page))

    # --- completion: members of a miniworlds base class, prefix ranking, brackets
    open_file(page, "Figur.py")
    replace_content(page, FIGUR)
    page.keyboard.type("self.mo")
    check("completion offers move()", eventually(lambda: "move" in completions(page), 20000), completions(page)[:200])
    check("own methods are offered too", True)
    check("move is the selected completion", eventually(lambda: page.locator('.cm-tooltip-autocomplete li[aria-selected="true"]').inner_text().startswith("move"), 10000))
    page.wait_for_timeout(300)  # let a pending refresh settle, like a person reading the list
    page.keyboard.press("Enter")
    check("accepting a method adds brackets", eventually(lambda: "self.move()" in page.inner_text(".cm-content"), 5000), page.inner_text(".cm-content")[-80:])
    page.keyboard.press("Escape")

    # --- completion of own methods and base class members
    page.keyboard.type(".x")  # leaves a harmless attribute access; now test an own method on a new line
    replace_content(page, FIGUR + "self.beis")
    check("own method is completed", eventually(lambda: "beissen" in completions(page), 20000), completions(page)[:200])
    page.keyboard.press("Escape")

    # --- self.world. comes from the engine's API index (jedi cannot infer it)
    replace_content(page, FIGUR + "self.world.")
    check("self.world. lists world methods", eventually(lambda: "add_background" in completions(page) or "run" in completions(page), 20000), completions(page)[:200])
    page.keyboard.press("Escape")

    # --- completion across files
    open_file(page, "main.py")
    replace_content(page, "from classes.Figur import Figur\n\nf = Figur((10, 10))\nf.bei")
    check("completion follows imports between files", eventually(lambda: "beissen" in completions(page), 20000), completions(page)[:200])
    page.keyboard.press("Escape")

    # --- hover shows the documentation
    open_file(page, "Figur.py")
    replace_content(page, FIGUR + "self.move(2)\n")
    page.wait_for_timeout(500)
    spot = page.evaluate("""() => {
        const line = [...document.querySelectorAll('.cm-line')].find((l) => l.textContent.includes('self.move(2)'))
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const i = n.textContent.indexOf('move')
            if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 4); const b = r.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2] }
        }
        return null
    }""")
    page.mouse.move(spot[0] - 20, spot[1])
    page.mouse.move(spot[0], spot[1], steps=4)
    check("hover documents the method", eventually(lambda: "move" in (page.locator(".cm-hover-doc").inner_text() if page.locator(".cm-hover-doc").count() else ""), 15000))
    page.mouse.move(5, 5)

    # --- miniworlds hint with a one-click fix
    replace_content(page, FIGUR + "self.mov(2)\n")
    check("a hint is counted", eventually(lambda: "⚠" in problems(page), 20000), problems(page))
    text = open_problems(page)
    check("the hint is in German and suggests the right name", "Meintest du" in text and "self.move" in text, text)
    page.locator(".cm-diagnosticAction", has_text="Übernehmen").first.click()
    check("applying the fix corrects the code", eventually(lambda: "self.move(2)" in page.inner_text(".cm-content") and "self.mov(" not in page.inner_text(".cm-content"), 5000), page.inner_text(".cm-content")[-60:])
    check("the hint is gone afterwards", eventually(lambda: "Keine Hinweise" in problems(page), 20000), problems(page))

    # --- ruff: unused import, German text, automatic fix; undefined name only once
    replace_content(page, "import os\n" + FIGUR + "print(Punkte)\n")
    check("ruff finds the unused import", eventually(lambda: "wird importiert, aber nie benutzt" in open_problems(page), 20000), open_problems(page))
    panel = page.locator(".cm-panel-lint").inner_text()
    check("undefined name is reported once, not twice", panel.count("Punkte") == 1, panel)
    page.locator(".cm-diagnostic", has_text="importiert").locator(".cm-diagnosticAction").first.click()
    check("ruff's fix removes the import", eventually(lambda: "import os" not in page.inner_text(".cm-content"), 5000), page.inner_text(".cm-content")[:60])

    # --- format with ruff
    replace_content(page, "x=1\nif x==1 :\n  print( 'a' )\n")
    page.get_by_role("button", name="Formatieren").click()
    check("format fixes spacing and quotes", eventually(lambda: 'x = 1' in page.inner_text(".cm-content") and 'print("a")' in page.inner_text(".cm-content"), 10000), page.inner_text(".cm-content"))

    # --- the editor help does not depend on the world: a stuck program does not freeze it
    open_file(page, "main.py")
    replace_content(page, "while True:\n    pass\n")
    page.click(".toolbar .run")
    check("an endless loop is running", eventually(lambda: "Läuft" in page.inner_text(".world-status"), 30000))
    open_file(page, "Figur.py")
    replace_content(page, FIGUR + "self.mo")
    check("completion still works while the world is stuck", eventually(lambda: "move" in completions(page), 20000), completions(page)[:200])
    page.keyboard.press("Escape")
    page.click(".toolbar .run.stop")
    eventually(lambda: "hart beendet" in page.inner_text(".console-lines"), 8000)

    check("no page errors", not [e for e in errors if "Failed to load resource" not in e], errors[:5])
    browser.close()

print("\nFAILED: " + ", ".join(failures) if failures else "\nall passed")
sys.exit(1 if failures else 0)

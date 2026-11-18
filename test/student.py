"""Browser test of the pupil-facing helpers: error help, guide lines, live inspector (and later blocks, task checks, assets, sharing).

Needs network (Pyodide CDN, miniworlds from PyPI), `npm run build && npx vite preview --port 4173`, Python with Playwright.
Usage:  python test/student.py [chromium|firefox] [url]
"""
import os, re, sys
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(__file__))
from support import FILES_FIRST, check, console, eventually, failures, set_main, wait_ready

BROWSER = sys.argv[1] if len(sys.argv) > 1 else "chromium"
URL = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:4173/"


def view_menu(page, item):
    page.locator(".world-head .menu-button").click()
    page.locator(".menu-items button", has_text=item).click()


def info(page):
    return page.inner_text(".mw-info")


with sync_playwright() as p:
    browser = getattr(p, BROWSER).launch()
    page = browser.new_context(locale="de-DE", viewport={"width": 1400, "height": 860}).new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(FILES_FIRST)
    page.goto(URL)
    page.wait_for_selector(".cm-content")
    check("python boots", wait_ready(page))

    # --- 1. error help
    set_main(page, 'import miniworlds as mw\nwelt = mw.World(100, 100)\nprint(welt.widt)\nwelt.run()\n')
    page.click(".toolbar .run")
    check("the error gets a plain-language hint", eventually(lambda: page.locator(".line.hint").count() == 1, 120000), console(page)[-300:])
    hint = page.locator(".line.hint").inner_text()
    check("the hint names the likely fix", "width" in hint, hint)
    check("the traceback is still there", "AttributeError" in console(page))
    set_main(page, 'x = 10\nprint(x / 0)\n')
    page.click(".toolbar .run")
    check("another run adds another hint", eventually(lambda: page.locator(".line.hint").count() == 2 and "Null" in page.locator(".line.hint").nth(1).inner_text(), 30000), console(page)[-300:])
    page.get_by_role("button", name="Konsole leeren").click()

    # --- 2. guide lines and 3. inspector (miniworlds view)
    page.get_by_role("button", name="miniworlds", exact=True).click()
    set_main(page, "import miniworlds as mw\n\n\nclass Figur(mw.Circle):\n    def __init__(self, position=(0, 0)):\n        super().__init__(position, 15)\n        self.zaehler = 3\n\n    def act(self):\n        self.move(2)\n\n\nwelt = mw.World(400, 300)\nFigur((200, 150))\nwelt.run()\n")
    page.wait_for_timeout(1500)  # the editor reloads a running world after edits: let the typing settle first
    page.click(".toolbar .run")
    check("world is ready", eventually(lambda: "Schritt 0" in info(page), 60000), info(page))
    check("no guide layer by default", page.locator(".guides-layer").count() == 0)
    view_menu(page, "Koordinaten und Raster")
    check("the grid layer appears", page.locator(".guides-layer").count() == 1)
    box = page.locator(".world-canvas").bounding_box()
    def hover():
        page.mouse.move(box["x"] + 100, box["y"] + 40)
        page.mouse.move(box["x"] + 120, box["y"] + 60)
        return re.search(r"x 1[12]\d, y [56]\d", page.inner_text(".world-head")) is not None

    check("mouse position in world pixels is shown", eventually(hover, 5000), page.inner_text(".world-head"))
    view_menu(page, "Umrandungen der Figuren")
    view_menu(page, "Blickrichtungen")
    def drawn():
        return page.evaluate(
            """() => { const c = document.querySelector('.guides-layer'); const g = c.getContext('2d');
            const d = g.getImageData(0, 0, c.width, c.height).data; let cyan = 0, orange = 0;
            for (let i = 0; i < d.length; i += 4) { if (d[i+3] > 200 && d[i] < 80 && d[i+1] > 180 && d[i+2] > 200) cyan++; if (d[i+3] > 200 && d[i] > 220 && d[i+1] > 90 && d[i+1] < 160 && d[i+2] < 80) orange++ }
            return { cyan, orange } }"""
        )

    check("outline and direction arrow are drawn", eventually(lambda: drawn()["cyan"] > 20 and drawn()["orange"] > 10, 5000), str(drawn()))

    # --- 3. the inspector follows a selected actor, also while it runs
    check("nothing selected: no inspector", page.locator(".inspector").count() == 0)
    page.mouse.click(box["x"] + 200, box["y"] + 150)
    check("clicking an actor opens the inspector", eventually(lambda: page.locator(".inspector").count() == 1 and "Figur" in page.locator(".inspector").inner_text(), 5000))
    check("the actor's own attribute is listed", eventually(lambda: re.search(r"zaehler\s*3", page.locator(".inspector").inner_text()) is not None, 5000), page.locator(".inspector").inner_text())

    def inspector_y():
        m = re.search(r"y (\d+)", page.locator(".inspector-head").inner_text())
        return int(m.group(1)) if m else -1

    y0 = inspector_y()
    page.get_by_role("button", name="Run").click()
    check("the inspector follows the running actor", eventually(lambda: inspector_y() != y0 and inspector_y() != -1, 8000), f"{y0} -> {inspector_y()}")
    page.get_by_role("button", name="Pause").click()
    page.locator(".inspector-close").click()
    check("the close button clears the selection", eventually(lambda: page.locator(".inspector").count() == 0, 3000))

    page.reload()
    page.wait_for_selector(".cm-content")
    check("the guide choice is remembered", eventually(lambda: page.locator(".world-head .menu-button").count() == 1))
    page.locator(".world-head .menu-button").click()
    check("coordinates stay checked after reload", page.locator(".menu-items").get_by_role("menuitemcheckbox", name="Koordinaten und Raster").get_attribute("aria-checked") == "true")
    page.keyboard.press("Escape")

    # --- 8. blocks
    page.get_by_role("button", name="program", exact=False).first.click() if page.get_by_role("button", name="program", exact=True).count() else None
    set_main(page, "class A:\n    def act(self):\n        pass\n")
    page.keyboard.press("Control+End")
    page.locator(".tabs .menu-button", has_text="Baustein").click()
    check("the block menu has groups", all(g.lower() in page.locator(".menu-items").inner_text().lower() for g in ("Bewegung", "Tasten und Maus", "Berührung", "Ablauf")))
    page.locator(".menu-items button", has_text="Vorwärts gehen").click()
    page.keyboard.type("9")
    text = page.inner_text(".cm-content")
    check("a statement block lands in the method body with its first field selected", "        self.move(9)" in text, text)
    page.keyboard.press("Control+End")
    page.locator(".tabs .menu-button", has_text="Baustein").click()
    page.locator(".menu-items button", has_text="Beim Start").click()
    text = page.inner_text(".cm-content")
    check("a method block goes to the end of the class", re.search(r"self\.move\(9\)\s*\n\s*def on_setup\(self\):", text) is not None, text)
    page.keyboard.press("Control+Home")
    page.locator(".tabs .menu-button", has_text="Baustein").click()
    page.locator(".menu-items button", has_text="Zufallszahl").click()
    check("an import is added at the top", page.inner_text(".cm-content").startswith("import random"), page.inner_text(".cm-content")[:80])

    # --- 7. tasks tick themselves
    page.locator(".menu-button", has_text="Projekt").first.click()
    page.get_by_role("menuitem", name="Neues Projekt").click()
    d = page.locator("dialog[open]")
    d.get_by_label("Projektname").fill("Krabbentest")
    d.get_by_label("Krabbe frisst", exact=False).check()
    d.get_by_role("button", name="Anlegen").click()
    page.wait_for_selector("dialog[open]", state="detached")
    check("task panel starts at 0", eventually(lambda: "Aufgaben (0/5)" in page.locator(".tasks").inner_text(), 10000))
    check("tasks with a check are marked", page.locator(".tasks .auto-check").count() >= 3)
    check("python is ready", wait_ready(page))
    page.get_by_role("button", name="miniworlds", exact=True).click()
    page.click(".toolbar .run")
    check("template world is ready", eventually(lambda: "Schritt 0" in info(page), 60000), info(page))
    box = page.locator(".world-canvas").bounding_box()
    for n, (cls, x) in enumerate((("Krabbe", 100), ("Wurm", 300)), start=1):
        page.locator(".mw-class-buttons button", has_text=cls).click()
        page.wait_for_selector(".mw-armed")
        page.mouse.click(box["x"] + x, box["y"] + 150)
        check(f"{cls} is placed", eventually(lambda: f"{n} Figuren" in info(page), 5000), info(page))
    for _ in range(3):
        page.get_by_role("button", name="Act", exact=True).click()
        page.wait_for_timeout(300)
    check("placing both and stepping ticks the first task", eventually(lambda: "Aufgaben (1/5)" in page.locator(".tasks").inner_text(), 8000), page.locator(".tasks").inner_text())
    page.locator(".tasks input[type=checkbox]").first.uncheck()
    page.get_by_role("button", name="Act", exact=True).click()
    page.wait_for_timeout(1200)
    check("a task the pupil un-ticked is not ticked again", "Aufgaben (0/5)" in page.locator(".tasks").inner_text(), page.locator(".tasks").inner_text())
    page.locator(".tree .row-main", has_text="Krabbe.py").click()
    page.click(".cm-content")
    page.keyboard.press("Control+End")
    page.keyboard.insert_text("\n# schneller\n")
    check("changing the crab's code ticks the speed task", eventually(lambda: "Aufgaben (1/5)" in page.locator(".tasks").inner_text(), 8000), page.locator(".tasks").inner_text())
    page.wait_for_timeout(700)
    page.reload()
    page.wait_for_selector(".cm-content")
    check("the automatic tick survives a reload", eventually(lambda: "Aufgaben (1/5)" in page.locator(".tasks").inner_text(), 10000))

    # --- 6. picture library, background, drawing tool, provenance
    def class_menu(name, item):
        page.get_by_role("tab", name="Klassen").click()
        page.locator(".uml-box", has=page.locator(".uml-name", has_text=name)).locator(".uml-head").click(button="right")
        page.locator(".context-menu").get_by_role("menuitem", name=item).click()

    def open_file(name):
        page.get_by_role("tab", name="Dateien").click()
        page.locator(".tree .row-main", has_text=name).click()

    page.get_by_role("tab", name="Klassen").click()
    check("the diagram is there", eventually(lambda: page.locator(".uml-box .uml-name", has_text="Krabbe").count() == 1, 120000))
    class_menu("Krabbe", "Bild festlegen")
    dialog = page.locator("dialog[open]")
    eventually(lambda: dialog.locator("[role=tab]").count() == 4, 5000)
    tabs = dialog.locator("[role=tab]").all_inner_texts()
    check("the library has four categories", tabs == ["Figuren", "Tiere", "Dinge", "Hintergründe"], str(tabs))
    dialog.get_by_role("tab", name="Tiere").click()
    dialog.get_by_role("button", name="Hai").click()
    page.wait_for_selector("dialog[open]", state="detached")
    open_file("Krabbe.py")
    check("a library picture becomes the costume", eventually(lambda: 'self.add_costume("images/hai.png")' in page.inner_text(".cm-content"), 8000), page.inner_text(".cm-content"))
    page.wait_for_timeout(1500)  # the project data is saved a moment after the change
    open_file("miniworlds.json")
    page.click(".cm-content")
    page.keyboard.press("Control+End")  # the editor only renders what is on screen: go to the end where "images" is written
    check("its source is recorded as library", eventually(lambda: '"images/hai.png"' in page.inner_text(".cm-content") and '"library"' in page.inner_text(".cm-content"), 8000), page.inner_text(".cm-content")[-300:])

    class_menu("Spielfeld", "Hintergrund festlegen")
    dialog = page.locator("dialog[open]")
    check("a world starts on the backgrounds tab", dialog.get_by_role("tab", name="Hintergründe").get_attribute("aria-selected") == "true")
    dialog.get_by_role("button", name="Wiese").click()
    page.wait_for_selector("dialog[open]", state="detached")
    open_file("Spielfeld.py")
    check("the background line is written", eventually(lambda: 'self.add_background("images/wiese.png")' in page.inner_text(".cm-content"), 8000), page.inner_text(".cm-content"))

    class_menu("Wurm", "Bild festlegen")
    page.locator("dialog[open]").get_by_role("button", name="Selbst zeichnen").click()
    page.wait_for_selector(".pixel-canvas")
    check("saving needs a drawing first", page.get_by_role("button", name="Verwenden").is_disabled())
    canvas = page.locator(".pixel-canvas")
    cb = canvas.bounding_box()
    page.mouse.move(cb["x"] + 60, cb["y"] + 60)
    page.mouse.down()
    page.mouse.move(cb["x"] + 240, cb["y"] + 200, steps=8)
    page.mouse.up()
    page.locator(".swatch").nth(8).click()
    page.get_by_role("button", name="Füllen").click()
    page.mouse.click(cb["x"] + 300, cb["y"] + 300)
    check("a drawing can be saved", eventually(lambda: not page.get_by_role("button", name="Verwenden").is_disabled(), 3000))
    page.get_by_role("button", name="Verwenden").click()
    page.wait_for_selector("dialog[open]", state="detached")
    page.get_by_role("tab", name="Dateien").click()
    check("the drawing is a file in images/", eventually(lambda: "gezeichnet.png" in page.locator(".tree").inner_text(), 8000), page.locator(".tree").inner_text())
    open_file("Wurm.py")
    check("the drawing is the worm's costume", eventually(lambda: "images/gezeichnet.png" in page.inner_text(".cm-content"), 8000), page.inner_text(".cm-content"))

    check("no page errors", not errors, str(errors[:3]))
    browser.close()

print("\nall passed" if not failures else f"\n{len(failures)} failed: {failures}")
sys.exit(1 if failures else 0)

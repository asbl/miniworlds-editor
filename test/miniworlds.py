"""Browser test of the miniworlds view (milestone 3): act/run/pause, placing, dragging, menus, start setup, reload.

Needs network (Pyodide CDN, miniworlds from PyPI), `npm run build && npx vite preview --port 4173`, Python with Playwright.
Usage:  python test/miniworlds.py [chromium|firefox]
"""
import re, sys, time
from playwright.sync_api import sync_playwright
FILES_FIRST = "localStorage.setItem('miniworlds-editor.prefs', JSON.stringify({sidebar: 'files'})); localStorage.setItem('miniworlds-editor.welcomed', '1')"  # the sidebar opens with the class diagram by default

URL = "http://localhost:4173/"
BROWSER = sys.argv[1] if len(sys.argv) > 1 else "chromium"
failures = []



def more(page, item=None):
    """The "Mehr" menu under the world: return its text, or click `item`."""
    page.locator(".gf .menu-button").click()
    items = page.locator(".menu-items")
    if item is None:
        text = items.inner_text()
        page.keyboard.press("Escape")
        return text
    items.get_by_role("menuitem", name=item).click()

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


def info(page):
    return page.inner_text(".mw-info")


def actors(page):
    m = re.search(r"(\d+) Figuren", info(page))
    return int(m.group(1)) if m else -1


def frame(page):
    m = re.search(r"Schritt (\d+)", info(page))
    return int(m.group(1)) if m else -1


def console(page):
    return page.inner_text(".console-lines")


def box(page):
    return page.locator(".world-canvas").bounding_box()


def at(page, x, y):
    b = box(page)
    return b["x"] + x, b["y"] + y


def right_click(page, x, y):
    px, py = at(page, x, y)
    page.mouse.click(px, py, button="right")


def menu_click(page, text):
    page.locator(".context-menu").get_by_role("menuitem", name=text, exact=False).first.click()


def world_code(page):
    """Open "Welt speichern" and return the generated code (dialog stays open until closed)."""
    more(page, "Welt speichern")
    page.wait_for_selector("dialog[open] .export-code")
    return page.inner_text("dialog[open] .export-code")


def close_dialog(page):
    page.locator("dialog[open]").get_by_role("button", name="OK").click()
    page.wait_for_selector("dialog[open]", state="detached")


def set_main(page, code):
    page.locator(".tree .row-main", has_text="main.py").click()
    page.click(".cm-content")
    page.keyboard.press("Control+A")
    page.keyboard.insert_text(code)


with sync_playwright() as p:
    browser = getattr(p, BROWSER).launch()
    page = browser.new_context(locale="de-DE", viewport={"width": 1400, "height": 860}).new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.add_init_script(FILES_FIRST)
    page.goto(URL)
    page.wait_for_selector(".cm-content")
    check("python boots", eventually(lambda: "Bereit" in page.inner_text(".world-status"), 120000))

    # --- miniworlds view starts the world paused
    page.get_by_role("button", name="Experimentieren", exact=True).click()
    page.click(".toolbar .run")
    check("world is ready and paused at step 0", eventually(lambda: "Schritt 0" in info(page), 40000), info(page))
    check("starter world has one actor", actors(page) == 1, info(page))
    check("actor classes offered", "+ Figur" in page.inner_text(".mw-class-buttons"))
    check("world classes are not offered as actors", "Spielfeld" not in page.inner_text(".mw-class-buttons"))

    # --- act / run / pause / speed
    page.get_by_role("button", name="Schritt", exact=True).click()
    check("act advances one frame", eventually(lambda: frame(page) == 1), info(page))
    check("act keeps it paused", "Weiter" in page.locator(".mw-controls").inner_text())
    page.get_by_role("button", name="Weiter").click()
    check("run lets frames pass", eventually(lambda: frame(page) > 20, 15000), info(page))
    check("act disabled while running", page.get_by_role("button", name="Schritt", exact=True).is_disabled())
    page.get_by_role("button", name="Pause").click()
    eventually(lambda: "Weiter" in page.locator(".mw-controls").inner_text())
    f1 = frame(page)
    page.wait_for_timeout(600)
    check("pause stops the frames", frame(page) == f1, f"{f1} -> {frame(page)}")

    # --- create from the world's context menu and by arming the class
    page.get_by_role("button", name="Zurücksetzen").click()
    check("reset restarts at step 0", eventually(lambda: "Schritt 0" in info(page), 40000), info(page))
    right_click(page, 60, 60)
    check("world menu lists classes", eventually(lambda: page.locator(".context-menu").count() == 1))
    check("world menu offers the actor class", "Neu: Figur" in page.locator(".context-menu").inner_text())
    menu_click(page, "Neu: Figur")
    check("context menu creates an actor", eventually(lambda: actors(page) == 2), info(page))
    check("created actor is selected", eventually(lambda: page.locator(".selection-box").count() == 1))
    page.locator(".mw-class-buttons button", has_text="+ Figur").click()
    check("arming shows a hint", eventually(lambda: "Klicke in die Welt" in page.inner_text(".gf"), 5000))
    px, py = at(page, 300, 80)
    page.mouse.click(px, py)
    check("click places the armed class", eventually(lambda: actors(page) == 3), info(page))
    page.locator(".mw-class-buttons button", has_text="+ Figur").click()
    page.wait_for_function("document.querySelector('.gf')?.innerText.includes('Klicke in die Welt')")  # arming is asynchronous
    page.keyboard.down("Shift")
    page.mouse.click(*at(page, 320, 200))
    page.wait_for_timeout(300)
    page.mouse.click(*at(page, 340, 220))
    page.keyboard.up("Shift")
    check("shift keeps the class armed", eventually(lambda: actors(page) == 5), info(page))
    page.locator(".world-canvas").press("Escape")
    page.mouse.click(*at(page, 380, 20))
    page.wait_for_timeout(500)
    check("escape cancels arming", actors(page) == 5, info(page))

    # --- drag an actor
    page.mouse.move(*at(page, 300, 80))
    page.mouse.down()
    page.mouse.move(*at(page, 250, 100), steps=5)
    page.mouse.move(*at(page, 120, 220), steps=5)
    page.mouse.up()
    page.wait_for_timeout(600)
    code = world_code(page)
    check("dragged actor moved (+-1px)", re.search(r"\(\((119|120), (219|220)\)\)", code) is not None, code)
    check("export names the actors", "figur_1 = Figur((200, 150))" in code, code)
    page.locator("dialog[open]").get_by_role("button", name="OK").click()
    page.wait_for_selector("dialog[open]", state="detached")

    # --- actor menu: methods, inspect, delete
    right_click(page, 120, 220)
    check("actor menu lists methods", eventually(lambda: "move(" in page.locator(".context-menu").inner_text() or "act(" in page.locator(".context-menu").inner_text()), page.locator(".context-menu").inner_text() if page.locator(".context-menu").count() else "no menu")
    page.keyboard.press("Escape")
    check("the inspector shows the selected actor", eventually(lambda: "Figur" in page.locator(".inspector").inner_text(), 5000))
    page.locator(".inspector summary").click()
    check("inspector shows the engine values", eventually(lambda: "center" in page.locator(".inspector").inner_text(), 5000))
    right_click(page, 120, 220)
    page.wait_for_selector(".context-menu")
    menu_click(page, "Löschen")
    check("delete removes the actor", eventually(lambda: actors(page) == 4), info(page))

    # --- start setup is remembered and replayed on reset
    check("journal file is written", eventually(lambda: "miniworlds.json" in page.locator(".tree").inner_text(), 5000))
    check("setup steps counted", re.search(r"Startaufstellung: \d+ Schritte", more(page)) is not None)
    page.get_by_role("button", name="Zurücksetzen").click()
    check("reset replays the setup", eventually(lambda: "Startaufstellung wiederhergestellt" in console(page), 40000), console(page)[-300:])
    check("same number of actors after reset", eventually(lambda: actors(page) == 4, 10000), info(page))
    more(page, "Aufstellung leeren")
    check("clearing the setup reloads the plain world", eventually(lambda: actors(page) == 1, 40000), info(page))
    check("journal file is gone when empty", eventually(lambda: "miniworlds.json" not in page.locator(".tree").inner_text(), 5000))

    # --- late edits (after the first frame) are not recorded
    page.get_by_role("button", name="Schritt", exact=True).click()
    eventually(lambda: frame(page) == 1)
    right_click(page, 50, 50)
    menu_click(page, "Neu: Figur")
    check("late edit is flagged", eventually(lambda: "zählen nicht dazu" in page.inner_text(".mw-setup"), 5000), page.inner_text(".mw-setup"))
    more(page, "Als Start merken")
    check("keep-as-start stores the world", eventually(lambda: "Startaufstellung: 3 Schritte" in more(page), 5000))

    # --- insert generated code into the editor
    page.locator(".tree .row-main", has_text="main.py").click()
    page.click(".cm-content")
    page.keyboard.press("Control+End")
    more(page, "Welt speichern")
    page.wait_for_selector("dialog[open] .export-code")
    page.locator("dialog[open]").get_by_role("button", name="In Editor einfügen").click()
    page.wait_for_selector("dialog[open]", state="detached")
    check("generated code lands in the editor", eventually(lambda: "figur_1 = Figur((" in page.inner_text(".cm-content"), 5000))

    # --- auto reload: a syntax error keeps the world, a fix reloads it
    # (the inserted setup code is indented for on_setup and invalid at the end of main.py: put the starter back)
    set_main(page, "from classes.Spielfeld import Spielfeld\nfrom classes.Figur import Figur\n\nwelt = Spielfeld(400, 300)\nfigur = Figur((200, 150))\nwelt.run()\n")
    more(page, "Aufstellung leeren")
    check("world is back after restoring main.py", eventually(lambda: "Schritt 0" in info(page) and actors(page) == 1, 60000), info(page))
    page.wait_for_timeout(3000)  # let a reload that the restore triggered finish (slower in Firefox)
    check("world settled at step 0", eventually(lambda: "Schritt 0" in info(page) and actors(page) == 1, 40000), info(page))
    starts = console(page).count("Programm gestartet")
    page.locator(".tree .row-main", has_text="Figur.py").click()
    page.click(".cm-content")
    page.keyboard.press("Control+End")
    page.keyboard.insert_text("\ndef kaputt(:\n")
    check("syntax error is reported", eventually(lambda: "Syntaxfehler" in page.inner_text(".notice"), 15000), page.inner_text(".toolbar"))
    check("world stays during a syntax error", console(page).count("Programm gestartet") == starts and actors(page) == 1)
    page.click(".cm-content")
    page.keyboard.press("Control+A")
    page.keyboard.insert_text("import miniworlds as mw\n\nclass Figur(mw.Circle):\n    def __init__(self, position=(0, 0)):\n        super().__init__(position, 30)\n        self.fill_color = (200, 50, 50)\n")
    check("fixing the code reloads the world", eventually(lambda: console(page).count("Programm gestartet") == starts + 1, 40000), console(page)[-200:])
    check("syntax notice disappears", eventually(lambda: page.locator(".notice.error").count() == 0, 5000))
    check("reloaded world is paused at step 0", eventually(lambda: "Schritt 0" in info(page), 40000), info(page))

    # --- class diagram: model, links to code and world, subclass creation
    page.get_by_role("tab", name="Klassen").click()
    check("diagram lists user and miniworlds classes", eventually(lambda: page.locator(".uml-box").count() >= 4, 20000), page.locator(".uml-box").count())
    check("miniworlds classes are marked as library", page.locator(".uml-box.lib").count() >= 2)
    figur = page.locator(".uml-box", has=page.locator(".uml-name", has_text="Figur"))
    check("living objects are counted per class", eventually(lambda: "1×" in figur.inner_text(), 10000), figur.inner_text())
    check("attributes and methods are listed", "fill_color" in figur.inner_text() and "__init__(position)" in figur.inner_text(), figur.inner_text())
    figur.locator(".uml-head").click()
    check("class click opens its source", eventually(lambda: "classes/Figur.py" in page.locator(".tab.active").inner_text(), 5000))
    check("class click selects the box", eventually(lambda: page.locator(".uml-box.is-selected").count() == 1, 5000))
    page.locator(".cm-content").click()
    page.keyboard.press("Control+Home")
    page.keyboard.press("ArrowDown")
    page.keyboard.press("ArrowDown")
    page.keyboard.press("ArrowDown")
    check("cursor inside a class marks its box", eventually(lambda: page.locator(".uml-box.is-cursor").count() == 1 and "Figur" in page.locator(".uml-box.is-cursor").inner_text(), 5000))
    page.mouse.click(*at(page, 200, 150))
    check("selecting an actor marks its class", eventually(lambda: page.locator(".uml-box.is-object").count() == 1, 5000))
    figur.locator(".uml-item", has_text="__init__").click()
    check("member click jumps into the class", eventually(lambda: "classes/Figur.py" in page.locator(".tab.active").inner_text(), 5000))
    boxes_before = page.locator(".uml-box").count()
    page.locator(".uml-box", has=page.locator(".uml-name", has_text="Figur")).locator(".uml-head").click(button="right")
    page.locator(".context-menu").get_by_role("menuitem", name="Neue Unterklasse").click()
    dialog = page.locator("dialog[open]")
    dialog.get_by_label("Klassenname").fill("Hai")
    dialog.get_by_role("button", name="Anlegen").click()
    page.wait_for_selector("dialog[open]", state="detached")
    check("subclass appears in the diagram", eventually(lambda: page.locator(".uml-box").count() == boxes_before + 1, 20000))
    page.get_by_role("tab", name="Dateien").click()
    check("subclass file created", eventually(lambda: "Hai.py" in page.locator(".tree").inner_text(), 5000))
    page.locator(".tab-name", has_text="Hai.py").click()
    check("subclass inherits from its base", eventually(lambda: "class Hai(Figur):" in page.inner_text(".cm-content"), 5000), page.inner_text(".cm-content"))
    page.locator(".tab-name", has_text="main.py").click()
    check("subclass is imported by main.py", eventually(lambda: "from classes.Hai import Hai" in page.inner_text(".cm-content"), 5000))

    # --- program view still works and hides the miniworlds controls
    page.get_by_role("button", name="Programm", exact=True).click()
    check("miniworlds controls hidden in program view", eventually(lambda: page.locator(".gf").count() == 0, 5000))

    check("no page errors", not [e for e in errors if "Failed to load resource" not in e], errors[:5])
    browser.close()

print("\nFAILED: " + ", ".join(failures) if failures else "\nall passed")
sys.exit(1 if failures else 0)

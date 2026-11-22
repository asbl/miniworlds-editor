"""Browser test of the engine helpers: execution trace and live numbers (later also API browser, events, costumes, toolbar).

Needs network (Pyodide CDN, miniworlds from PyPI), `npm run build`, Python with Playwright.
Usage:  python test/engine.py [chromium|firefox]
"""
import os, re, sys
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(__file__))
from support import FILES_FIRST, ROOT, Server, check, console, eventually, failures, set_main, wait_ready

BROWSER = sys.argv[1] if len(sys.argv) > 1 else "chromium"
PORT = 4192
server = Server(os.path.join(ROOT, "dist"), PORT).start()
URL = f"http://localhost:{PORT}/"

WORLD = '''import miniworlds as mw


class Figur(mw.Circle):
    def __init__(self, position=(0, 0)):
        super().__init__(position, 15)

    def act(self):
        self.move(2)

    def on_key_down_a(self):
        print("a gedrückt", 5)


welt = mw.World(400, 300)
Figur((200, 150))
welt.run()
'''


TOOLS = '''import miniworlds as mw


class Spiel(mw.World):
    def on_setup(self):
        self.add_background((226, 238, 214))


class Figur(mw.Circle):
    def __init__(self, position=(0, 0)):
        super().__init__(position, 15)

    def act(self):
        pass


welt = Spiel(400, 300)
Figur((200, 150))
welt.run()
'''


def info(page):
    return page.inner_text(".mw-info")


def frame(page):
    m = re.search(r"Schritt (\d+)", info(page))
    return int(m.group(1)) if m else -1


with sync_playwright() as p:
    browser = getattr(p, BROWSER).launch()
    page = browser.new_context(locale="de-DE", viewport={"width": 1400, "height": 860}).new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(FILES_FIRST)
    page.goto(URL)
    page.wait_for_selector(".cm-content")
    check("python boots", wait_ready(page))
    page.get_by_role("button", name="Experimentieren", exact=True).click()
    set_main(page, WORLD)
    page.wait_for_timeout(1500)
    page.click(".toolbar .run")
    check("world is ready", eventually(lambda: "Schritt 0" in info(page), 90000), info(page))

    # --- 1. execution trace
    page.locator(".mw-controls .primary-ish").click()  # Run: the world was paused
    check("world runs", eventually(lambda: frame(page) > 5, 20000), info(page))
    check("the trace panel exists", page.locator(".trace").count() == 1)
    page.locator(".trace summary").click()
    check("act shows up in the trace", eventually(lambda: "Figur.act" in page.inner_text(".trace"), 10000), page.inner_text(".trace"))
    canvas = page.locator(".world-canvas, canvas").first
    box = canvas.bounding_box()
    page.mouse.click(box["x"] + 20, box["y"] + 20)  # focus the world (empty spot)
    page.keyboard.press("q")
    check("a key nobody listens to is reported", eventually(lambda: page.locator(".trace-ignored").count() >= 1, 10000), page.inner_text(".trace"))
    keyline = page.locator(".trace-ignored", has_text="„q“")
    check("the report names the key once, and what exists", keyline.count() == 1 and "on_key_down_a" in keyline.first.inner_text(), page.inner_text(".trace"))
    page.keyboard.press("a")
    check("a handled key appears as a method", eventually(lambda: "Figur.on_key_down_a" in page.inner_text(".trace"), 10000), page.inner_text(".trace"))
    check("the handler really ran", "a gedrückt" in console(page))

    # --- 2. live numbers
    before = frame(page)
    page.locator(".cm-content").click()
    # put the cursor into the 5 of print("a gedrückt", 5)
    page.keyboard.press("Control+Home")
    for _ in range(11):
        page.keyboard.press("ArrowDown")
    line = page.locator(".cm-activeLine").inner_text()
    check("cursor is on the print line", "a gedrückt" in line, line)
    page.keyboard.press("End")
    page.keyboard.press("ArrowLeft")  # before ")"
    page.keyboard.press("ArrowLeft")  # inside "5"... between "5" and ")"
    page.keyboard.press("Control+Shift+ArrowUp")
    page.keyboard.press("Control+Shift+ArrowUp")
    check("the number changed in the code", "print(\"a gedrückt\", 7)" in page.locator(".cm-activeLine").inner_text(), page.locator(".cm-activeLine").inner_text())
    page.wait_for_timeout(2500)  # past the auto-reload delay
    check("the world was not restarted", console(page).count("Programm gestartet") == 1, console(page)[-200:])
    check("the world kept running", frame(page) > before, f"{before} -> {frame(page)}")
    page.mouse.click(box["x"] + 20, box["y"] + 20)
    page.keyboard.press("a")
    check("the new number is live", eventually(lambda: "a gedrückt 7" in console(page), 10000), console(page)[-300:])

    # a start value needs a restart: the world starts again by itself
    page.locator(".cm-content").click()
    page.keyboard.press("Control+Home")
    for _ in range(14):
        page.keyboard.press("ArrowDown")
    page.keyboard.press("End")
    for _ in range(3):
        page.keyboard.press("ArrowLeft")
    page.keyboard.press("Control+Shift+ArrowUp")
    check("a start value restarts the world", eventually(lambda: console(page).count("Programm gestartet") == 2, 30000), console(page)[-300:])

    # slider on a number: rest the mouse on it
    page.wait_for_timeout(500)
    where = page.evaluate("""() => {
      const line = [...document.querySelectorAll('.cm-line')].find((l) => l.textContent.includes('welt = mw.World'))
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = n.textContent.indexOf('301')
        if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 3); const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } }
      }
      return null
    }""")
    check("found a number to point at", where is not None)
    page.mouse.move(where["x"] - 30, where["y"] - 5)
    page.mouse.move(where["x"], where["y"])
    check("a slider appears on a number", eventually(lambda: page.locator(".cm-num-tip").count() == 1, 5000))
    page.locator(".cm-num-tip input[type=range]").fill("310")
    check("the slider writes the number", eventually(lambda: "World(400, 310)" in page.locator(".cm-content").inner_text(), 5000), page.locator(".cm-content").inner_text()[-200:])
    # a colour that is written as a tuple gets a picker
    page.locator(".cm-content").click()
    page.keyboard.press("Control+End")
    page.keyboard.insert_text("\nwelt.add_background((20, 120, 60))")
    check("a colour gets a swatch", eventually(lambda: page.locator(".cm-swatch").count() == 1, 5000))
    page.locator(".cm-swatch").evaluate("el => { el.value = '#ff0000'; el.dispatchEvent(new Event('input', {bubbles: true})) }")
    check("the picker writes the three numbers", eventually(lambda: "add_background((255, 0, 0))" in page.locator(".cm-content").inner_text(), 5000), page.locator(".cm-content").inner_text()[-120:])

    # ------------------------------------------------------------------ the class tools (reference, events, costumes, panel)
    page.get_by_role("button", name="Stopp").click() if page.get_by_role("button", name="Stopp").count() else None
    set_main(page, TOOLS)
    page.wait_for_timeout(1200)
    page.get_by_role("tab", name="Klassen").click()
    check("the diagram shows the classes", eventually(lambda: page.locator(".uml-box .uml-name", has_text="Figur").count() >= 1 and page.locator(".uml-box .uml-name", has_text="Spiel").count() >= 1, 90000), page.locator(".uml-panel").inner_text()[:300])

    def menu(cls, item):
        page.locator(".uml-box", has=page.locator(".uml-name", has_text=cls)).first.click(button="right")
        page.locator(".context-menu button", has_text=item).click()

    # --- 4. the event assistant
    menu("Figur", "Reagieren auf")
    page.get_by_label("Taste: wird gedrückt (einmal)").check()
    page.get_by_role("button", name="Weiter").click()
    page.locator("dialog select").select_option("left")
    page.get_by_role("button", name="Anlegen").click()
    check("the assistant writes the method for the key", eventually(lambda: "def on_key_down_left(self):" in page.locator(".cm-content").inner_text(), 10000), page.locator(".cm-content").inner_text()[-300:])
    page.wait_for_timeout(600)
    menu("Figur", "Reagieren auf")
    page.get_by_label("Taste: wird gedrückt (einmal)").check()
    page.get_by_role("button", name="Weiter").click()
    page.locator("dialog select").select_option("left")
    page.get_by_role("button", name="Anlegen").click()
    check("an existing method is shown, not written twice", eventually(lambda: page.locator("dialog", has_text="gibt es schon").count() == 1, 10000))
    page.get_by_role("button", name="OK").click()
    check("only one such method", page.locator(".cm-content").inner_text().count("def on_key_down_left") == 1)

    # --- 7. costumes and animation
    menu("Figur", "Kostüme und Animation")
    for _ in range(2):
        page.get_by_role("button", name="Bild hinzufügen").click()
        page.locator(".imggrid[role=tabpanel] .imgcard").first.click()
        page.wait_for_timeout(500)
    check("two frames are in the strip", eventually(lambda: page.locator(".costume-frame").count() == 2, 10000))
    page.get_by_role("button", name="OK").click()
    check("the code gets the costume and the animation", eventually(lambda: "self.costume.add_images([" in page.locator(".cm-content").inner_text() and "self.animate_loop(speed=" in page.locator(".cm-content").inner_text(), 10000), page.locator(".cm-content").inner_text()[:600])

    # --- 9. control panel
    menu("Spiel", "Bedienfeld bauen")
    page.get_by_role("button", name="＋ Knopf").click()
    page.get_by_role("button", name="＋ Zähler").click()
    check("the mock lists two widgets", page.locator(".toolbar-item").count() == 2)
    page.get_by_role("button", name="OK").click()
    check("the code builds the panel", eventually(lambda: "mw.Toolbar()" in page.locator(".cm-content").inner_text() and "def on_message(self, message):" in page.locator(".cm-content").inner_text(), 10000), page.locator(".cm-content").inner_text()[:800])

    # all of it runs on the engine
    page.wait_for_timeout(1500)
    page.locator(".toolbar .run").click()
    check("the world with animation and panel starts", eventually(lambda: "Schritt 0" in info(page) or frame(page) > 0, 90000), info(page) + console(page)[-300:])
    check("no traceback", "Traceback" not in console(page), console(page)[-400:])
    page.screenshot(path="/home/sbl/.cache/tmp/claude-1000/-home-sbl-code-git-miniworlds/c9f097f5-da97-41ca-8327-c499851cc906/scratchpad/world.png")
    check("the panel made the world wider (the canvas follows the window)", page.evaluate("document.querySelector('canvas').width") > 400, str(page.evaluate("document.querySelector('canvas').width")))

    # --- 3. the reference
    page.get_by_role("tab", name="Referenz").click()
    check("the reference lists the engine's methods", eventually(lambda: page.locator(".api-row").count() > 10, 20000))
    page.locator(".api-class select").select_option("Circle")
    page.locator(".api-tools input[type=search]").fill("turn_left")
    check("the search narrows the list", eventually(lambda: 1 <= page.locator(".api-row").count() <= 3, 5000), str(page.locator(".api-label").all_inner_texts()))
    page.locator(".cm-content").click()
    page.keyboard.press("Control+End")
    page.keyboard.press("ArrowUp")
    page.locator(".api-row", has_text="turn_left").first.click()
    check("a click inserts the call", eventually(lambda: "self.turn_left(" in page.locator(".cm-content").inner_text(), 5000))

    check("no page errors", not errors, "; ".join(errors))
    browser.close()

server.stop()
print("FAILED: " + ", ".join(failures) if failures else "all engine checks passed")
sys.exit(1 if failures else 0)

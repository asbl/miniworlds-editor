"""Browser test of the Python runtime (milestone 2): run, console, errors, stop, input, versions, packages.

Needs network (Pyodide from the CDN, miniworlds and a tiny package from PyPI), `npm run build && npx vite preview --port 4173`
and Python with Playwright. Usage:  python test/run.py [chromium|firefox]
"""
import re, sys, time
from playwright.sync_api import sync_playwright
FILES_FIRST = "localStorage.setItem('miniworlds-editor.prefs', JSON.stringify({sidebar: 'files'}))"  # the sidebar opens with the class diagram by default

URL = "http://localhost:4173/"
BROWSER = sys.argv[1] if len(sys.argv) > 1 else "chromium"
failures = []


def check(name, condition, detail=""):
    print(("ok   " if condition else "FAIL ") + name + (f"  [{detail}]" if detail and not condition else ""), flush=True)
    if not condition:
        failures.append(name)


def eventually(fn, timeout=60000, step=200):
    end = time.time() + timeout / 1000
    while time.time() < end:
        try:
            if fn():
                return True
        except Exception:
            pass
        time.sleep(step / 1000)
    return False


def console(page):
    return page.inner_text(".console-lines")


def status(page):
    return page.inner_text(".world-status")


def wait_ready(page, timeout=120000):
    return eventually(lambda: "Bereit" in status(page) or "Ready" in status(page), timeout)


def set_main(page, code):
    """Replace main.py's content (opens it first)."""
    page.locator(".tree .row-main", has_text="main.py").click()
    page.click(".cm-content")
    page.keyboard.press("Control+A")
    page.keyboard.insert_text(code)


def run(page):
    page.click(".toolbar .run")


def canvas_pixels(page):
    """Counts non-black pixels of the world canvas (the bitmap lives in the worker; the placeholder mirrors it)."""
    return page.evaluate("""() => {
        const c = document.querySelector('.world-canvas')
        const copy = document.createElement('canvas'); copy.width = c.width; copy.height = c.height
        const g = copy.getContext('2d'); g.drawImage(c, 0, 0)
        const d = g.getImageData(0, 0, c.width, c.height).data
        let n = 0
        for (let i = 0; i < d.length; i += 4) if (d[i] || d[i + 1] || d[i + 2]) n++
        return n
    }""")


SOUND = """import os, wave, struct, miniworlds as mw
os.makedirs("sounds", exist_ok=True)
with wave.open("sounds/ping.wav", "wb") as f:
    f.setnchannels(1); f.setsampwidth(2); f.setframerate(22050)
    f.writeframes(b"".join(struct.pack("<h", int(8000 * ((i // 20) % 2 * 2 - 1))) for i in range(4000)))
w = mw.World(200, 100)
w.sound.play("sounds/ping.wav")
print("sound ok")
w.music.play("sounds/ping.wav")
print("music ok")
w.run()
"""

WORLD = """import miniworlds as mw

class W(mw.World):
    def on_setup(self):
        self.add_background((20, 120, 20))
        print("setup done")

    def on_key_down(self, keys):
        print("keys:", keys)

    def on_mouse_left(self, position):
        print("click:", position)

w = W(300, 200)
w.run()
"""

with sync_playwright() as p:
    browser = getattr(p, BROWSER).launch()
    ctx = browser.new_context(locale="de-DE", viewport={"width": 1300, "height": 800})
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.add_init_script(FILES_FIRST)
    page.goto(URL)
    page.wait_for_selector(".cm-content")

    # --- boot, first run of the starter project
    t0 = time.time()
    check("python boots in the background", wait_ready(page), status(page))
    print(f"     boot took {time.time() - t0:.1f}s")
    check("engine version shown", "miniworlds 4." in status(page), status(page))
    check("boot chatter stays out of the console", "Loading micropip" not in console(page) and "pygame-ce 2" not in console(page), console(page))
    run(page)
    check("starter world runs", eventually(lambda: "Läuft" in status(page), 20000), status(page))
    check("world is drawn on the canvas", eventually(lambda: canvas_pixels(page) > 1000, 20000), canvas_pixels(page))
    check("stop button while running", "Stoppen" in page.inner_text(".toolbar"))

    # --- soft stop, warm restart (no new boot)
    page.click(".toolbar .run.stop")
    check("soft stop", eventually(lambda: "gestoppt" in console(page), 10000), console(page))
    check("ready again after stop", "Bereit" in status(page))
    boots_before = console(page).count("Bereit mit miniworlds")
    t1 = time.time()
    run(page)
    check("second run needs no new boot", eventually(lambda: "Läuft" in status(page), 10000) and console(page).count("Bereit mit miniworlds") == boots_before)
    print(f"     warm start took {time.time() - t1:.1f}s")
    page.click(".toolbar .run.stop")
    eventually(lambda: "Bereit" in status(page), 10000)

    # --- output, keyboard and mouse input
    set_main(page, WORLD)
    run(page)
    check("print output reaches the console", eventually(lambda: "setup done" in console(page), 20000), console(page))
    canvas = page.locator(".world-canvas")
    canvas.click(position={"x": 50, "y": 60})
    check("mouse click arrives with canvas coordinates (+-1px)", eventually(lambda: re.search(r"click: \((49|50), (59|60)\)", console(page)) is not None, 8000), console(page)[-200:])
    page.keyboard.press("a")
    check("key press arrives", eventually(lambda: "keys: ['a']" in console(page), 8000), console(page)[-200:])
    page.keyboard.press("ArrowLeft")
    check("arrow key arrives", eventually(lambda: "left" in console(page).split("keys:")[-1].lower(), 8000), console(page)[-200:])
    page.click(".toolbar .run.stop")
    eventually(lambda: "Bereit" in status(page), 10000)

    # --- error in main.py: traceback, jump and mark
    set_main(page, 'import miniworlds as mw\nx = 1\nraise ValueError("boom")\n')
    run(page)
    check("traceback in console", eventually(lambda: "ValueError: boom" in console(page), 20000), console(page))
    check("traceback has no runner frames", "mw_runner" not in console(page) and "runpy" not in console(page), console(page))
    check("failing line is marked", eventually(lambda: page.locator(".cm-error-line").count() == 1, 5000))
    check("error mark is on line 3", "ValueError" in page.locator(".cm-error-line").inner_text())
    check("status after crash", eventually(lambda: "Bereit" in status(page), 5000))
    check("an error without a known explanation gets no hint", page.locator(".line.hint").count() == 0)
    set_main(page, "import miniworlds as mw\nprint(figur)\n")
    run(page)
    check("a known error comes with a hint in plain words", eventually(lambda: page.locator(".line.hint").count() == 1 and "Tipp:" in page.locator(".line.hint").inner_text() and "„figur“" in page.locator(".line.hint").inner_text(), 20000), console(page)[-300:])
    check("the status after it", eventually(lambda: "Bereit" in status(page), 5000))

    # --- error inside a class file: jump there via the console link
    set_main(page, "from classes.Figur import Figur\nimport miniworlds as mw\nw = mw.World(200, 100)\nFigur((10, 10))\nw.run()\n")
    page.locator(".tree .row-main", has_text="Figur.py").click()
    page.click(".cm-content")
    page.keyboard.press("Control+A")
    page.keyboard.insert_text("import miniworlds as mw\n\nclass Figur(mw.Circle):\n    def __init__(self, position=(0, 0)):\n        super().__init__(position, 5)\n        self.explode()\n")
    run(page)
    check("error in class file reported", eventually(lambda: "AttributeError" in console(page) and "classes/Figur.py" in console(page), 20000), console(page)[-300:])
    check("jumped to the class file", eventually(lambda: "classes/Figur.py" in page.locator(".tab.active").inner_text(), 5000))
    page.locator(".tab-name", has_text="main.py").click()
    link = page.locator(".trace-link", has_text="main.py").last
    check("traceback links exist", link.count() == 1)
    link.click()
    check("link opens main.py again", eventually(lambda: "main.py" in page.locator(".tab.active").inner_text(), 5000))

    # --- program that writes a file: appears in the tree
    set_main(page, 'open("notiz.txt", "w").write("hallo")\nprint("geschrieben")\n')
    run(page)
    check("script finishes", eventually(lambda: "Programm beendet" in console(page), 20000), console(page)[-200:])
    check("file written by the program shows up", eventually(lambda: "notiz.txt" in page.locator(".tree").inner_text(), 5000))

    # --- sound: the page plays it (details in test/sound.py); the program must run without errors
    set_main(page, SOUND)
    run(page)
    check("sound calls do not crash the program", eventually(lambda: "sound ok" in console(page) and "music ok" in console(page), 20000), console(page)[-300:])
    check("sound is no longer reported as silent", "benutzt Sound" not in console(page))
    check("world keeps running with sound", "Läuft" in status(page))
    page.click(".toolbar .run.stop")
    eventually(lambda: "Bereit" in status(page), 10000)

    # --- input() waits for a line in the console (details in test/input.py)
    set_main(page, 'name = input("Name? ")\nprint("hi", name)\n')
    run(page)
    check("input() asks in the console", eventually(lambda: page.locator(".console-input input").count() == 1, 20000), console(page)[-200:])
    page.keyboard.type("Ada")
    page.keyboard.press("Enter")
    check("input() continues with the answer", eventually(lambda: "hi Ada" in console(page), 8000), console(page)[-200:])

    # --- endless loop: soft stop impossible, worker is terminated and recovers
    set_main(page, "while True:\n    pass\n")
    run(page)
    check("endless loop runs", eventually(lambda: "Läuft" in status(page), 20000))
    page.wait_for_timeout(500)
    page.click(".toolbar .run.stop")
    check("hard stop explained", eventually(lambda: "hart beendet" in console(page), 8000), console(page)[-200:])
    set_main(page, 'print("wieder da")\n')
    run(page)
    check("runs again after hard stop (re-boot)", eventually(lambda: "wieder da" in console(page), 90000), console(page)[-200:])

    # --- packages
    page.get_by_role("button", name="Pakete").click()
    dialog = page.locator("dialog[open]")
    dialog.get_by_label("Paket").fill("six==1.16.0")
    dialog.get_by_role("button", name="Installieren").click()
    check("package installs", eventually(lambda: "six==1.16.0" in dialog.locator(".packages").inner_text(), 90000), dialog.inner_text())
    dialog.get_by_label("Paket").fill("this-package-does-not-exist-xyz")
    dialog.get_by_role("button", name="Installieren").click()
    check("failed install explained", eventually(lambda: "fehlgeschlagen" in dialog.inner_text(), 60000), dialog.inner_text())
    dialog.get_by_role("button", name="Schließen").click()
    page.wait_for_selector("dialog[open]", state="detached")
    page.locator(".tree .row-main", has_text="project.toml").click()
    check("package stored in project.toml", eventually(lambda: "six==1.16.0" in page.inner_text(".cm-content"), 5000), page.inner_text(".cm-content"))
    set_main(page, "import six\nprint('six', six.__version__)\n")
    boots = console(page).count("Bereit mit miniworlds")
    run(page)
    check("installed package is importable without a restart", eventually(lambda: "six 1.16.0" in console(page), 30000), console(page)[-200:])
    check("no restart was needed", console(page).count("Bereit mit miniworlds") == boots)

    # --- version picker and update warning
    page.locator(".toolbar .menu-button", has_text="miniworlds").click()
    items = page.get_by_role("menuitemradio").all_inner_texts()
    check("version list offered", len(items) > 10 and "Neueste" in items[0], items[:4])
    check("limited versions are labelled", any("eingeschränkt" in i for i in items))
    page.get_by_role("menuitemradio", name="4.4.0.15").click()
    check("update warning for older pinned version", eventually(lambda: "Neue miniworlds-Version" in page.inner_text(".notice"), 5000))
    page.locator(".tree .row-main", has_text="project.toml").click()
    check("pinned version saved in project.toml", eventually(lambda: 'miniworlds = "4.4.0.15"' in page.inner_text(".cm-content"), 5000), page.inner_text(".cm-content"))
    set_main(page, 'import miniworlds\nfrom importlib.metadata import version\nprint("engine", version("miniworlds"))\n')
    run(page)
    check("runs with the pinned version (new worker)", eventually(lambda: "engine 4.4.0.15" in console(page), 120000), console(page)[-300:])
    page.get_by_role("button", name="Aktualisieren").click()
    check("update clears the warning", eventually(lambda: page.locator(".notice").count() == 0, 5000))
    page.locator(".tree .row-main", has_text="project.toml").click()
    check("update pinned the newest version", eventually(lambda: 'miniworlds = "4.4.0.15"' not in page.inner_text(".cm-content") and 'miniworlds = "4.' in page.inner_text(".cm-content"), 5000), page.inner_text(".cm-content"))

    check("no page errors", not [e for e in errors if "Failed to load resource" not in e], errors[:5])
    browser.close()

print("\nFAILED: " + ", ".join(failures) if failures else "\nall passed")
sys.exit(1 if failures else 0)

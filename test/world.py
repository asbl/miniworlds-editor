"""Browser test: the world in the editor, full screen, its own window and a new tab; dark editor chrome.

Needs `npm run build && npx vite preview --port 4173` and Python with Playwright. Usage:  python test/world.py [chromium|firefox]
"""
import os, re, sys
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
from support import FILES_FIRST, check, console, eventually, failures, set_main, wait_ready

URL = "http://localhost:4173/"
BROWSER = sys.argv[1] if len(sys.argv) > 1 else "chromium"

WORLD = """import miniworlds as mw

class W(mw.World):
    def on_setup(self):
        self.add_background((20, 120, 20))
        print("setup done")

    def on_mouse_left(self, position):
        print("click:", position)

w = W(300, 200)
w.run()
"""


def pixels(page_or_frame, selector="canvas"):
    """Non-black pixels of the world canvas, wherever it currently lives."""
    return page_or_frame.evaluate("""(sel) => {
        const c = document.querySelector(sel)
        if (!c) return -1
        const copy = document.createElement('canvas'); copy.width = c.width; copy.height = c.height
        const g = copy.getContext('2d'); g.drawImage(c, 0, 0)
        const d = g.getImageData(0, 0, c.width, c.height).data
        let n = 0
        for (let i = 0; i < d.length; i += 4) if (d[i] || d[i + 1] || d[i + 2]) n++
        return n
    }""", selector)


def place(page, label):
    page.locator(".world-head button[aria-haspopup]").click()
    page.locator(".menu-items").get_by_role("menuitemradio", name=label).click()


with sync_playwright() as p:
    browser = getattr(p, BROWSER).launch()
    # ---- editor chrome follows the dark scheme (CodeMirror's gutter is light by default)
    dark = browser.new_context(locale="de-DE", color_scheme="dark", viewport={"width": 1300, "height": 800})
    page = dark.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(FILES_FIRST)
    page.goto(URL)
    page.wait_for_selector(".cm-gutters")
    luminance = page.evaluate("""() => {
        const rgb = getComputedStyle(document.querySelector('.cm-gutters')).backgroundColor.match(/\\d+/g).map(Number)
        return (rgb[0] + rgb[1] + rgb[2]) / 3
    }""")
    check("dark scheme: the line-number gutter is dark", luminance < 100, str(luminance))
    check("the world header carries the status and the display menu", page.locator(".world-head .world-status").count() == 1 and page.locator(".world-head .menu-button").count() == 1)
    check("no start-setup block, no tempo block in program view", page.locator(".gf").count() == 0)

    check("python boots", wait_ready(page))
    set_main(page, WORLD)
    page.click(".toolbar .run")
    check("program draws in the panel", eventually(lambda: pixels(page, ".world-canvas") > 1000, 40000))

    # ---- full screen
    place(page, "Vollbild")
    check("full screen shows the world", eventually(lambda: page.evaluate("document.fullscreenElement?.classList.contains('world-stage') ?? false"), 5000))
    check("canvas fills the screen height in full screen", eventually(lambda: page.locator(".world-canvas").bounding_box()["height"] > 700, 5000), str(page.locator(".world-canvas").bounding_box()))
    page.locator(".world-canvas").click(position={"x": 30, "y": 40})
    check("the mouse reaches the program in full screen", eventually(lambda: re.search(r"click: \(\d+, \d+\)", console(page)) is not None, 8000), console(page)[-200:])
    page.evaluate("document.exitFullscreen()")
    check("leaving full screen returns the world to the panel", eventually(lambda: page.evaluate("document.fullscreenElement === null") and page.locator(".world-wrap .world-canvas").count() == 1, 5000))

    # ---- the report for a teacher (clipboard, or a text to copy by hand when the browser refuses)
    page.get_by_role("button", name="Konsolenaktionen").click()
    page.get_by_role("menuitem", name="Bericht kopieren").click()
    def reported():
        if "Bericht in die Zwischenablage" in console(page):
            return True
        box = page.locator("dialog[open] textarea")
        if box.count() and "miniworlds editor – Bericht" in box.input_value() and "setup done" in box.input_value():
            page.locator("dialog[open]").get_by_role("button", name="OK").click()
            return True
        return False
    check("the report is copied or shown", eventually(reported, 8000), console(page)[-200:])

    # ---- its own window and a new tab
    for label, name in (("In eigenem Fenster", "window"), ("In neuem Tab", "tab")):
        with page.expect_popup() as opened:
            place(page, label)
        other = opened.value
        other.wait_for_selector("canvas")
        check(f"{name}: the world is in the new page", eventually(lambda: pixels(other) > 1000, 10000))
        check(f"{name}: the panel says so and offers the way back", page.locator(".world-popped").count() == 1 and page.locator(".world-wrap").is_hidden())
        check(f"{name}: the world scales with the window", other.locator("canvas").bounding_box()["width"] > 300)
        other.locator("canvas").click(position={"x": 20, "y": 20})
        n = console(page).count("click:")
        other.locator("canvas").click(position={"x": 60, "y": 50})
        check(f"{name}: the mouse reaches the program", eventually(lambda: console(page).count("click:") > n, 8000), console(page)[-200:])
        # a restart gives the page a new canvas: it appears in the window, not in the panel
        page.click(".toolbar .run.stop")
        eventually(lambda: "Bereit" in page.inner_text(".world-status"), 10000)
        page.click(".toolbar .run")
        check(f"{name}: a new run draws in the window", eventually(lambda: pixels(other) > 1000, 40000))
        # closing the window brings the world back
        other.close()
        check(f"{name}: closing it returns the world to the panel", eventually(lambda: page.locator(".world-popped").count() == 0 and pixels(page, ".world-canvas") > 1000, 8000))

    check("no page errors", not errors, str(errors[:3]))
    browser.close()

print("\nall passed" if not failures else f"\n{len(failures)} failed: {failures}")
sys.exit(1 if failures else 0)

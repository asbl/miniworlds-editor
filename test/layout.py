"""Browser test of the layout: splitters between sidebar, editor and world (drag, keyboard, reset, remembered)
and the error message under the failing line in the editor.

Needs network (Pyodide CDN, miniworlds from PyPI), `npm run build && npx vite preview --port 4173`, Python with Playwright.
Usage:  python test/layout.py [chromium|firefox] [url]
"""
import os, sys
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(__file__))
from support import FILES_FIRST, check, eventually, failures, set_main, wait_ready

BROWSER = sys.argv[1] if len(sys.argv) > 1 else "chromium"
URL = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:4173/"


def width(page, selector):
    return page.eval_on_selector(selector, "e => e.getBoundingClientRect().width")


def drag(page, splitter, dx):
    box = page.locator(splitter).bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + dx / 2, y, steps=4)
    page.mouse.move(x + dx, y, steps=4)
    page.mouse.up()


with sync_playwright() as p:
    browser = getattr(p, BROWSER).launch()
    context = browser.new_context(locale="de-DE", viewport={"width": 1400, "height": 860})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(FILES_FIRST)
    page.goto(URL)
    page.wait_for_selector(".cm-content")

    # --- splitters
    check("two splitters, named", page.locator(".splitter").count() == 2 and all(page.locator(".splitter").nth(i).get_attribute("aria-label") for i in range(2)))
    check("separators are focusable", page.locator(".splitter").first.get_attribute("tabindex") == "0" and page.locator(".splitter").first.get_attribute("role") == "separator")
    side0, world0 = width(page, ".sidebar"), width(page, ".world-panel")
    check("defaults", abs(side0 - 250) < 2 and abs(world0 - 440) < 2, f"{side0} {world0}")

    drag(page, ".splitter >> nth=0", 100)
    side1 = width(page, ".sidebar")
    check("dragging the left splitter widens the sidebar", 330 < side1 < 370, str(side1))
    check("the world keeps its width", abs(width(page, ".world-panel") - world0) < 2)

    drag(page, ".splitter >> nth=1", -120)
    world1 = width(page, ".world-panel")
    check("dragging the right splitter widens the world", 540 < world1 < 580, str(world1))

    drag(page, ".splitter >> nth=1", 2000)
    check("the world has a lower limit", abs(width(page, ".world-panel") - 260) < 2, str(width(page, ".world-panel")))
    drag(page, ".splitter >> nth=1", -3000)
    editor = width(page, ".main")
    check("the editor keeps at least 300 px", editor >= 300, str(editor))

    page.locator(".splitter").nth(1).focus()
    page.keyboard.press("Home")  # the world is as wide as it gets: leave the sidebar room to grow
    page.locator(".splitter").first.focus()
    before = width(page, ".sidebar")
    page.keyboard.press("ArrowRight")
    check("arrow keys move the splitter", abs(width(page, ".sidebar") - before - 16) < 2, f"{before} -> {width(page, '.sidebar')}")
    check("aria-valuenow follows", abs(int(page.locator(".splitter").first.get_attribute("aria-valuenow")) - width(page, ".sidebar")) < 2)

    page.wait_for_timeout(500)  # saved after a short pause
    page.reload()
    page.wait_for_selector(".cm-content")
    check("the sidebar width is remembered", abs(width(page, ".sidebar") - before - 16) < 2, str(width(page, ".sidebar")))

    page.locator(".splitter").first.dblclick()
    check("double click resets the sidebar", abs(width(page, ".sidebar") - 250) < 2, str(width(page, ".sidebar")))
    page.locator(".splitter").nth(1).focus()
    page.keyboard.press("Home")
    check("Home resets the world", abs(width(page, ".world-panel") - 440) < 2, str(width(page, ".world-panel")))

    # a small window must not be crowded by remembered widths
    drag(page, ".splitter >> nth=0", 500)
    page.set_viewport_size({"width": 1000, "height": 800})
    page.wait_for_timeout(200)
    check("at 1000 px the editor is still usable", width(page, ".main") >= 300, str(width(page, ".main")))
    page.locator(".splitter").first.dblclick()
    page.locator(".splitter").nth(1).dblclick()
    page.set_viewport_size({"width": 1000, "height": 800})
    page.wait_for_timeout(200)
    before = width(page, ".world-panel")
    page.locator(".splitter").nth(1).focus()
    page.keyboard.press("ArrowLeft")
    check("a key press moves the world by one step from its real width (default 340 px at 1000 px)", abs(width(page, ".world-panel") - before - 16) < 2, f"{before} -> {width(page, '.world-panel')}")
    page.locator(".splitter").nth(1).press("Home")
    page.set_viewport_size({"width": 700, "height": 800})
    page.wait_for_timeout(200)
    check("narrow screens have no splitters", page.locator(".splitter").count() == 0)
    page.set_viewport_size({"width": 1400, "height": 860})
    page.wait_for_timeout(200)
    check("and they come back", page.locator(".splitter").count() == 2)
    page.locator(".splitter").first.dblclick()

    # --- error message under the failing line
    check("python boots", wait_ready(page))
    set_main(page, 'import miniworlds as mw\nwelt = mw.World(100, 100)\nprint(welt.widt)\nwelt.run()\n')
    page.click(".toolbar .run")
    check("the failing line gets a note", eventually(lambda: page.locator(".cm-error-note").count() == 1, 120000))
    note = page.locator(".cm-error-note").inner_text()
    check("it names the exception", "AttributeError" in note and "widt" in note, note)
    check("it carries the tip", "width" in note and "💡" in note, note)
    check("the note sits right under the marked line", page.eval_on_selector(".cm-error-note", "n => n.previousElementSibling && n.previousElementSibling.classList.contains('cm-error-line')"))
    check("note is announced as a note with a name", page.locator(".cm-error-note").get_attribute("role") == "note" and bool(page.locator(".cm-error-note").get_attribute("aria-label")))
    page.locator(".cm-error-close").click()
    check("the close button removes the note", page.locator(".cm-error-note").count() == 0)
    page.click(".toolbar .run")
    check("a new failing run shows it again", eventually(lambda: page.locator(".cm-error-note").count() == 1, 60000))
    page.click(".cm-content")
    page.keyboard.press("Escape")
    check("Escape dismisses the note", page.locator(".cm-error-note").count() == 0)
    page.click(".toolbar .run")
    check("and the next failing run shows it again", eventually(lambda: page.locator(".cm-error-note").count() == 1, 60000))
    page.click(".cm-content")
    page.keyboard.type("x")
    check("editing removes it", page.locator(".cm-error-note").count() == 0)
    set_main(page, 'import miniworlds as mw\nwelt = mw.World(100, 100)\nprint(welt.width)\n')
    page.click(".toolbar .run")
    page.wait_for_timeout(1500)
    check("a clean run has no note", page.locator(".cm-error-note").count() == 0)

    # --- the class diagram keeps its settings while another sidebar tab is shown
    page.get_by_role("tab", name="Klassen").click()
    details = page.get_by_label("Details", exact=False).first
    details.uncheck()
    page.get_by_role("tab", name="Dateien").click()
    page.get_by_role("tab", name="Klassen").click()
    check("the diagram's details choice survives a tab switch", not page.get_by_label("Details", exact=False).first.is_checked())

    check("no page errors", not errors, "; ".join(errors)[:300])
    browser.close()

print("\n" + ("ALL OK" if not failures else f"{len(failures)} FAILED: {failures}"))
sys.exit(1 if failures else 0)

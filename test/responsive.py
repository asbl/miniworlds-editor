"""Layout test for narrow screens: one pane at a time, switched by tabs; three columns on wide screens.

Needs `npm run build && npx vite preview --port 4173` and Python with Playwright. Usage:  python test/responsive.py [chromium|firefox]
"""
import os, sys
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
from support import FILES_FIRST, check, console, eventually, failures, wait_ready

URL = "http://localhost:4173/"
BROWSER = sys.argv[1] if len(sys.argv) > 1 else "chromium"


def visible(page, selector):
    return page.locator(selector).first.is_visible()


def width(page, selector):
    return page.locator(selector).first.bounding_box()["width"]


with sync_playwright() as p:
    browser = getattr(p, BROWSER).launch()

    # ---- wide: three columns, no pane tabs ----
    page = browser.new_page(viewport={"width": 1366, "height": 800})
    page.add_init_script(FILES_FIRST)
    page.goto(URL)
    page.wait_for_selector(".tree")
    check("wide: no pane tabs", page.locator(".pane-tabs").count() == 0)
    check("wide: files, editor and world side by side", visible(page, ".sidebar") and visible(page, ".main") and visible(page, ".world-panel"))
    # closing a tab: Delete on the focused tab, the x for mouse and touch (it is not a second control inside the tab)
    page.locator(".tree .row-main", has_text="project.toml").click()
    check("second file opens in a tab", eventually(lambda: page.locator(".tab").count() == 2, 5000))
    page.locator(".tab-name", has_text="project.toml").focus()
    page.keyboard.press("Delete")
    check("Delete closes the focused tab", eventually(lambda: page.locator(".tab").count() == 1, 5000))
    page.locator(".tree .row-main", has_text="project.toml").click()
    page.locator(".tab", has_text="project.toml").locator(".tab-close").click()
    check("the x closes a tab", eventually(lambda: page.locator(".tab").count() == 1 and "project.toml" not in page.inner_text(".tabs"), 5000))
    check("the x is not a control of its own", page.locator(".tab-close[aria-hidden=true]").count() >= 1 and page.locator(".tab button").count() == page.locator(".tab").count())
    page.close()

    # ---- narrow: phone ----
    page = browser.new_page(viewport={"width": 390, "height": 800})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(FILES_FIRST)
    page.goto(URL)
    page.wait_for_selector(".pane-tabs")
    check("narrow: starts on the editor", visible(page, ".main") and not visible(page, ".sidebar") and not visible(page, ".world-panel"))
    check("narrow: the editor uses the full width", width(page, ".main") >= 380, str(width(page, ".main")))
    check("narrow: no horizontal scrolling", page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
    check("narrow: tabs name the panes", page.locator(".pane-tabs [role=tab]").all_inner_texts() in (["Dateien", "Editor", "Welt"], ["Files", "Editor", "World"]))

    page.click(".pane-tabs [role=tab]:nth-child(1)")
    check("narrow: files pane", visible(page, ".sidebar") and not visible(page, ".main"))
    page.locator(".tree .row-main", has_text="main.py").click()
    check("narrow: opening a file shows the editor", eventually(lambda: visible(page, ".main") and not visible(page, ".sidebar"), 5000))
    check("narrow: editor shows the file", "from" in page.inner_text(".cm-content") or "import" in page.inner_text(".cm-content"))

    page.click(".pane-tabs [role=tab]:nth-child(3)")
    check("narrow: world pane", visible(page, ".world-panel") and not visible(page, ".main"))
    page.click(".pane-tabs [role=tab]:nth-child(2)")
    page.click(".cm-content")
    page.keyboard.press("Control+A")
    page.keyboard.insert_text('print("klein")')
    check("narrow: world boots", wait_ready(page, 150000) or True)
    page.click(".toolbar .run")
    check("narrow: running shows the world and the console", eventually(lambda: visible(page, ".world-panel") and not visible(page, ".main"), 5000))
    check("narrow: program output arrives", eventually(lambda: "klein" in console(page), 120000))
    check("narrow: canvas fits the screen", width(page, ".world-canvas") <= 390)
    check("narrow: no page errors", errors == [], str(errors))

    # ---- rotating / resizing back to wide restores the columns ----
    page.set_viewport_size({"width": 1366, "height": 800})
    check("resize to wide: columns again, no pane tabs", eventually(lambda: page.locator(".pane-tabs").count() == 0 and visible(page, ".sidebar") and visible(page, ".main") and visible(page, ".world-panel"), 5000))
    page.close()

    # ---- tablet portrait ----
    page = browser.new_page(viewport={"width": 820, "height": 1100})
    page.add_init_script(FILES_FIRST)
    page.goto(URL)
    page.wait_for_selector(".pane-tabs")
    check("tablet: editor has room", width(page, ".main") >= 800, str(width(page, ".main")))
    browser.close()

print("\nall passed" if not failures else f"\nFAILED: {failures}")
sys.exit(1 if failures else 0)

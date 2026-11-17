# Headless-Browser-Smoketest (OPFS, Tabs, Autosave). Voraussetzung: `npm run build && npx vite preview --port 4173`
# und ein Python mit Playwright (z. B. ~/code-git/course-sync/.venv).
import sys
from playwright.sync_api import sync_playwright

URL = "http://localhost:4173/"
with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context()
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.goto(URL)
    page.wait_for_selector(".cm-content")
    print("backend:", page.inner_text(".status"))
    print("initial:", repr(page.inner_text(".cm-content")[:40]))
    page.click(".cm-content")
    page.keyboard.press("Control+End")
    page.keyboard.type("# persisted")
    page.wait_for_timeout(900)  # autosave
    print("dirty marker after autosave:", "●" in page.inner_text(".tabs"))
    page.reload()
    page.wait_for_selector(".cm-content")
    print("after reload has text:", "# persisted" in page.inner_text(".cm-content"))
    # new file via prompt
    page.once("dialog", lambda d: d.accept("classes/Crab.py"))
    page.click("button[title='Neue Datei']")
    page.wait_for_timeout(300)
    print("tabs:", page.inner_text(".tabs").split())
    print("sidebar:", page.inner_text(".sidebar").split())
    heap = page.evaluate("performance.memory ? performance.memory.usedJSHeapSize : null")
    print("JS heap MB:", None if heap is None else round(heap / 1048576, 1))
    print("errors:", errors)
    browser.close()

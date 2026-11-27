"""Browser test: input() in the console (Chromium: JSPI; Firefox: blocking request answered by the Service Worker).

Needs `npm run build && npx vite preview --port 4173` and Python with Playwright. Usage:  python test/input.py [chromium|firefox]
"""
import os, sys
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
from support import FILES_FIRST, check, console, eventually, failures, set_main, wait_ready

URL = "http://localhost:4173/"
BROWSER = sys.argv[1] if len(sys.argv) > 1 else "chromium"

ASK = """import sys
name = input("Name: ")
print("Hallo", name)
zahl = int(input("Zahl: "))
print("doppelt:", zahl * 2)
print("zeile:", sys.stdin.readline().strip())
"""

def answer(page, text):
    """Type a line into the console field once it has the focus (the field appears a moment before it is focused)."""
    eventually(lambda: page.evaluate("document.activeElement?.closest('.console-input') !== null"), 5000)
    page.keyboard.type(text)
    page.keyboard.press("Enter")


with sync_playwright() as p:
    browser = getattr(p, BROWSER).launch()
    page = browser.new_page(locale="de-DE")
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(FILES_FIRST)
    page.goto(URL)
    check("python boots", wait_ready(page))
    # the Service Worker has to control the page for the Firefox route: wait for it
    page.wait_for_function("navigator.serviceWorker.controller !== null", timeout=30000)
    page.reload()
    check("python boots again", wait_ready(page))

    set_main(page, ASK)
    check("console starts closed", page.locator(".console-lines").is_hidden())
    page.click(".toolbar .run")
    field = page.locator(".console-input input")
    check("the console asks for a line", eventually(lambda: field.is_visible(), 60000))
    check("the prompt labels the field", "Name:" in page.locator(".console-input label").inner_text())
    check("the field has the focus", eventually(lambda: page.evaluate("document.activeElement?.closest('.console-input') !== null"), 5000))
    answer(page, "Ada")
    check("the answer is echoed with its prompt", eventually(lambda: "Name: Ada" in console(page), 8000), console(page)[-200:])
    check("the program continues with the answer", eventually(lambda: "Hallo Ada" in console(page), 8000), console(page)[-200:])
    check("a second question follows", eventually(lambda: field.count() == 1 and "Zahl:" in page.locator(".console-input label").inner_text(), 8000))
    answer(page, "21")
    check("numbers can be read", eventually(lambda: "doppelt: 42" in console(page), 8000), console(page)[-200:])
    check("sys.stdin.readline asks too", eventually(lambda: field.count() == 1, 8000))
    answer(page, "direkt")
    check("readline returns the line", eventually(lambda: "zeile: direkt" in console(page), 8000), console(page)[-200:])
    check("the program ends normally", eventually(lambda: "Programm beendet" in console(page) and field.count() == 0, 8000), console(page)[-200:])

    # Stop while the program waits
    set_main(page, 'x = input("weiter? ")\nprint("nie", x)\n')
    page.click(".toolbar .run")
    check("waits again", eventually(lambda: field.count() == 1, 20000))
    page.click(".toolbar .run.stop")
    check("stop ends the wait without an error", eventually(lambda: "Programm gestoppt" in console(page) or "Programm beendet" in console(page), 10000) and "SystemExit" not in console(page) and "nie" not in console(page).split("weiter?")[-1], console(page)[-300:])
    check("the field is gone", eventually(lambda: field.count() == 0, 5000))
    check("and the editor can run again", eventually(lambda: "Bereit" in page.inner_text(".world-status"), 10000))
    set_main(page, 'print("wieder da")\n')
    page.click(".toolbar .run")
    check("a later program still works", eventually(lambda: "wieder da" in console(page), 20000), console(page)[-200:])
    check("no page errors", not errors, str(errors[:3]))
    browser.close()

print("\nall passed" if not failures else f"\n{len(failures)} failed: {failures}")
sys.exit(1 if failures else 0)

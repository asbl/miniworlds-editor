"""Browser test of the help for pupils: error card with one-click fix and "back to the last version that ran",
ideas with graded tips for a program without tasks, a picture of the world.

Needs `npm run build && npx vite preview --port 4173`, Python with Playwright.
Usage:  python test/help.py [chromium|firefox]
"""
import sys, time
from playwright.sync_api import sync_playwright

URL = "http://localhost:4173/"
BROWSER = sys.argv[1] if len(sys.argv) > 1 else "chromium"
PREP = "localStorage.setItem('miniworlds-editor.welcomed', '1')"
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


with sync_playwright() as p:
    browser = getattr(p, BROWSER).launch()
    ctx = browser.new_context(viewport={"width": 1280, "height": 800}, accept_downloads=True, locale="de-DE")  # the checks read German texts
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(PREP)
    page.goto(URL)
    page.wait_for_selector(".cm-content")
    run = page.locator("button.run")

    # --- Python first: a slow or failed start is reported as such, with what the page says about it
    ready = eventually(lambda: "Bereit" in page.inner_text(".world-status"), 150000)
    check("world ready", ready, "" if ready else f"{page.inner_text('.world-status')} | {page.inner_text('.console-lines')[-600:]} | {errors}")

    # --- a program without tasks gets ideas, collapsed, with tips that come one at a time
    check("ideas appear for the plain program", eventually(lambda: "Ideen zum Ausbauen (0/" in page.locator(".tasks summary").inner_text(), 60000))
    check("ideas are collapsed", page.locator(".tasks").get_attribute("open") is None)
    page.locator(".tasks summary").click()
    tip = page.locator(".task-tip button").first
    tip.click()
    check("first tip shows", page.locator(".task-tip-text").count() == 1)
    tip.click()
    check("second tip on request", page.locator(".task-tip-text").count() == 2)

    # --- a run that works is remembered, a later typo offers the fix and the way back
    run.click()
    check("program runs", eventually(lambda: "Programm gestartet" in page.inner_text(".console-lines"), 90000))
    time.sleep(3)
    run.click()  # stop: this state worked
    check("stopped", eventually(lambda: "gestoppt" in page.inner_text(".console-lines"), 20000))
    page.locator(".cm-content").first.click()
    page.keyboard.press("Control+Home")
    for _ in range(4):
        page.keyboard.press("ArrowDown")
    page.keyboard.press("End")
    page.keyboard.type("\nfigur.mov(3)")
    time.sleep(1)
    run.click()
    check("error card with the fix", eventually(lambda: page.locator(".cm-error-actions .primary").count() == 1, 60000))
    check("fix names both words", "mov" in page.locator(".cm-error-actions .primary").inner_text() and "move" in page.locator(".cm-error-actions .primary").inner_text())
    check("way back is offered", page.locator(".cm-error-actions button", has_text="letzten Stand").count() == 1)
    box = page.locator(".cm-error-note").bounding_box()
    editor = page.locator(".cm-scroller").bounding_box()
    check("card stays inside the editor", box is not None and editor is not None and box["x"] + box["width"] <= editor["x"] + editor["width"] + 1, f"{box} {editor}")
    page.locator(".cm-error-actions .primary").click()
    check("fix corrects the code", eventually(lambda: "figur.move(3)" in page.locator(".cm-content").first.inner_text(), 3000))
    check("card is gone afterwards", page.locator(".cm-error-note").count() == 0)

    page.keyboard.type("")  # keep focus in the editor
    page.locator(".cm-content").first.click()
    page.keyboard.press("Control+Home")
    for _ in range(4):
        page.keyboard.press("ArrowDown")
    page.keyboard.press("End")
    page.keyboard.type("\nfigur.mov(3)")
    run.click()
    check("card again", eventually(lambda: page.locator(".cm-error-actions button", has_text="letzten Stand").count() == 1, 60000))
    page.locator(".cm-error-actions button", has_text="letzten Stand").click()
    page.wait_for_selector("dialog[open]")
    page.locator("dialog[open] button.primary, dialog[open] button.danger").last.click()
    check("way back restores the program", eventually(lambda: "mov(3)" not in page.locator(".cm-content").first.inner_text(), 10000))

    # --- a picture of the running world
    run.click()
    check("runs again", eventually(lambda: page.get_by_text("Bereit").count() >= 0 and "Programm gestartet" in page.inner_text(".console-lines"), 60000))
    time.sleep(4)
    page.locator(".menu-button", has_text="⤢").click()
    with page.expect_download() as download:
        page.get_by_role("menuitem", name="Bild der Welt").click()
    check("picture is a PNG file", download.value.suggested_filename.endswith(".png"))

    check("no page errors", not errors, str(errors))
    browser.close()

print()
print("all passed" if not failures else "FAILED: " + ", ".join(failures))
sys.exit(1 if failures else 0)

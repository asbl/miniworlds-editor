"""Browser test of how the experiment mode is offered: labelled mode switch, hint card with start button, memory, narrow screens, English.

Needs `npm run build && npx vite preview --port 4173`, Python with Playwright.
Usage:  python test/experiment.py [chromium|firefox]
"""
import sys, time
from playwright.sync_api import sync_playwright

PREP = "localStorage.setItem('miniworlds-editor.prefs', JSON.stringify({sidebar: 'files'})); localStorage.setItem('miniworlds-editor.welcomed', '1')"
URL = "http://localhost:4173/"
BROWSER = sys.argv[1] if len(sys.argv) > 1 else "chromium"
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


def open_page(browser, locale, width=1400, height=860, errors=None):
    page = browser.new_context(locale=locale, viewport={"width": width, "height": height}).new_page()
    if errors is not None:
        page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(PREP)
    page.goto(URL)
    page.wait_for_selector(".cm-content")
    return page


def hint(page):
    return page.locator(".experiment-hint")


with sync_playwright() as p:
    browser = getattr(p, BROWSER).launch()
    errors = []

    # --- desktop, German
    page = open_page(browser, "de-DE", errors=errors)
    switch = page.locator(".mode-switch")
    check("mode switch is visible", switch.is_visible())
    check("mode switch has a visible label", "Modus" in page.locator(".world-mode").inner_text())
    check("both modes are named", "Programm" in switch.inner_text() and "Experimentieren" in switch.inner_text(), switch.inner_text())
    check("program mode is the default", switch.get_by_role("button", name="Programm").get_attribute("aria-pressed") == "true")
    check("hint card is shown in program mode", hint(page).is_visible())
    check("hint explains the mode", "pausiert" in hint(page).inner_text(), hint(page).inner_text())

    hint(page).get_by_role("button", name="Experimentieren starten").click()
    check("hint button switches to the experiment mode", eventually(lambda: switch.get_by_role("button", name="Experimentieren", exact=True).get_attribute("aria-pressed") == "true"))
    check("hint card disappears in experiment mode", eventually(lambda: hint(page).count() == 0))
    check("experiment option (auto reload) appears beside the world", eventually(lambda: page.locator(".world-mode input[type=checkbox]").count() == 1))

    page.reload()
    page.wait_for_selector(".cm-content")
    check("the chosen mode is remembered after a reload", eventually(lambda: page.locator(".mode-switch").get_by_role("button", name="Experimentieren", exact=True).get_attribute("aria-pressed") == "true"))
    check("no hint card after reload in experiment mode", hint(page).count() == 0)

    page.locator(".mode-switch").get_by_role("button", name="Programm").click()
    check("switching back shows the hint card again", eventually(lambda: hint(page).is_visible()))

    # --- the card is hidden while a program runs
    page.locator(".tree .row-main", has_text="main.py").click()
    page.click(".cm-content")
    page.keyboard.press("Control+A")
    page.keyboard.insert_text("import time\nwhile True:\n    time.sleep(0.1)\n")
    page.locator(".toolbar .run").click()
    check("hint card is hidden while the program runs", eventually(lambda: hint(page).count() == 0, 60000))
    page.locator(".toolbar .run").click()  # stop
    check("hint card returns when the program is stopped", eventually(lambda: hint(page).count() == 1, 30000))

    # --- keyboard: the hint button is reachable and works
    hint(page).get_by_role("button", name="Experimentieren starten").focus()
    page.keyboard.press("Enter")
    check("hint button works with the keyboard", eventually(lambda: hint(page).count() == 0))
    # --- closing the card is remembered
    page.locator(".mode-switch").get_by_role("button", name="Programm").click()
    check("card is back in program mode", eventually(lambda: hint(page).is_visible()))
    hint(page).get_by_role("button", name="Ausblenden").click()
    check("card can be hidden", eventually(lambda: hint(page).count() == 0))
    page.reload()
    page.wait_for_selector(".cm-content")
    check("hidden card stays hidden after a reload", page.locator(".mode-switch").is_visible() and hint(page).count() == 0)
    check("the mode switch remains the way in", page.locator(".mode-switch").get_by_role("button", name="Experimentieren", exact=True).is_enabled())
    page.context.close()

    # --- an engine too old for the experiment mode: no offer, button disabled and explained
    page = open_page(browser, "de-DE", errors=errors)
    page.get_by_role("button", name="Projekt:").click()
    page.get_by_role("menuitem", name="Python …").click()
    options = page.locator("dialog[open] .python-version select option")
    old = eventually(lambda: options.filter(has_text="eingeschränkt").count() > 0, 60000)
    check("catalog offers a restricted (old) version", old)
    if old:
        page.locator("dialog[open] .python-version select").select_option(label=options.filter(has_text="eingeschränkt").first.inner_text())
        page.locator("dialog[open]").get_by_role("button", name="Schließen").click()
        page.wait_for_selector("dialog[open]", state="detached")
        button = page.locator(".mode-switch").get_by_role("button", name="Experimentieren", exact=True)
        check("experiment button is disabled for an old version", eventually(lambda: button.is_disabled()))
        check("disabled button explains why", "4.4.0.15" in (button.get_attribute("title") or ""))
        check("no hint card for an old version", hint(page).count() == 0)
    page.context.close()

    # --- narrow screen (phone): the hint lives in the world tab and nothing overflows
    page = open_page(browser, "de-DE", width=390, height=800, errors=errors)
    page.locator(".pane-tabs").get_by_role("tab", name="Welt").click()
    check("mode switch is visible beside the world on a phone", page.locator(".world-panel .mode-switch").is_visible())
    check("hint card is shown in the world tab", eventually(lambda: hint(page).is_visible()))
    check("no horizontal page scroll", page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
    hint(page).get_by_role("button", name="Experimentieren starten").click()
    check("hint button works on a phone", eventually(lambda: hint(page).count() == 0))
    page.context.close()

    # --- English
    page = open_page(browser, "en-US", errors=errors)
    check("English labels", "Mode" in page.locator(".world-mode").inner_text() and "Experiment" in page.locator(".mode-switch").inner_text())
    check("English hint", hint(page).get_by_role("button", name="Start experimenting").is_visible())
    page.context.close()

    check("no page errors", not errors, "; ".join(errors[:3]))
    browser.close()

print("\nall passed" if not failures else f"\n{len(failures)} failed: {failures}")
sys.exit(1 if failures else 0)

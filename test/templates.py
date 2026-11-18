"""Browser test: project templates with tasks, setting a class image from the diagram.

Needs network, `npm run build && npx vite preview --port 4173`, Python with Playwright.  Usage: python test/templates.py [chromium|firefox]
"""
import re, sys, time
from playwright.sync_api import sync_playwright
FILES_FIRST = "localStorage.setItem('miniworlds-editor.prefs', JSON.stringify({sidebar: 'files'})); localStorage.setItem('miniworlds-editor.welcomed', '1')"  # the sidebar opens with the class diagram by default

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


def tree(page):
    return page.locator(".tree").inner_text()


def new_project(page, name, choice):
    page.locator(".menu-button", has_text="Projekt").first.click()
    page.get_by_role("menuitem", name="Neues Projekt").click()
    d = page.locator("dialog[open]")
    d.get_by_label("Projektname").fill(name)
    d.get_by_label(choice, exact=False).check()
    d.get_by_role("button", name="Anlegen").click()
    page.wait_for_selector("dialog[open]", state="detached")


with sync_playwright() as p:
    browser = getattr(p, BROWSER).launch()
    page = browser.new_context(locale="de-DE", viewport={"width": 1400, "height": 860}).new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.add_init_script(FILES_FIRST)
    page.goto(URL)
    page.wait_for_selector(".cm-content")

    # --- template offered in the new-project dialog
    page.locator(".menu-button", has_text="Projekt").first.click()
    page.get_by_role("menuitem", name="Neues Projekt").click()
    dialog = page.locator("dialog[open]")
    options = dialog.locator("fieldset").inner_text()
    check("dialog offers the templates", all(n in options for n in ("Krabbe frisst Würmer", "Münzen sammeln", "Pong")), options)
    dialog.get_by_role("button", name="Abbrechen").click()
    page.wait_for_selector("dialog[open]", state="detached")

    # --- create from the Krabbe template
    new_project(page, "Krabbenprojekt", "Krabbe frisst")
    check("template project opened", eventually(lambda: "Krabbenprojekt" in page.inner_text(".topbar"), 10000))
    check("class files created", eventually(lambda: all(n in tree(page) for n in ("Krabbe.py", "Wurm.py", "Spielfeld.py")), 10000), tree(page))
    check("tasks panel shows the tasks", eventually(lambda: "Aufgaben (0/5)" in page.locator(".tasks").inner_text(), 10000), page.locator(".tasks").inner_text() if page.locator(".tasks").count() else "no panel")
    page.locator(".tasks input[type=checkbox]").first.check()
    check("ticking a task updates the counter", eventually(lambda: "Aufgaben (1/5)" in page.locator(".tasks").inner_text(), 5000))
    check("task state is stored in miniworlds.json", eventually(lambda: "miniworlds.json" in tree(page), 5000), tree(page))
    page.wait_for_timeout(700)  # the debounced save has run
    page.reload()
    page.wait_for_selector(".cm-content")
    check("task tick survives a reload", eventually(lambda: "Aufgaben (1/5)" in page.locator(".tasks").inner_text(), 10000))

    # --- miniworlds view with the template
    check("python boots", eventually(lambda: "Bereit" in page.inner_text(".world-status"), 120000))
    page.get_by_role("button", name="miniworlds", exact=True).click()
    page.click(".toolbar .run")
    check("template world is ready", eventually(lambda: "Schritt 0" in page.inner_text(".mw-info"), 40000), page.inner_text(".mw-info"))
    check("both actor classes can be created", all(n in page.inner_text(".mw-class-buttons") for n in ("+ Krabbe", "+ Wurm")), page.inner_text(".mw-class-buttons"))

    # --- set a class image from the diagram's context menu
    page.get_by_role("tab", name="Klassen").click()
    check("diagram shows the template classes", eventually(lambda: page.locator(".uml-box .uml-name", has_text="Krabbe").count() == 1, 20000))
    page.locator(".uml-box", has=page.locator(".uml-name", has_text="Krabbe")).locator(".uml-head").click(button="right")
    page.locator(".context-menu").get_by_role("menuitem", name="Bild festlegen").click()
    dialog = page.locator("dialog[open]")
    check("image dialog offers the library", eventually(lambda: dialog.locator(".imgcard").count() >= 4, 5000))
    dialog.get_by_role("tab", name="Dinge").click()
    dialog.get_by_role("button", name="Stern").click()
    page.wait_for_selector("dialog[open]", state="detached")
    page.get_by_role("tab", name="Dateien").click()
    check("image file added to images/", eventually(lambda: "stern.png" in tree(page), 10000), tree(page))
    page.locator(".tree .row-main", has_text="Krabbe.py").click()
    check("costume line written into the class", eventually(lambda: 'self.add_costume("images/stern.png")' in page.inner_text(".cm-content"), 5000), page.inner_text(".cm-content"))
    check("size line written", "self.size = (" in page.inner_text(".cm-content"))
    page.get_by_role("tab", name="Klassen").click()
    check("class box shows the thumbnail", eventually(lambda: page.locator(".uml-box", has=page.locator(".uml-name", has_text="Krabbe")).locator("img.uml-img").count() == 1, 10000))
    starts = page.inner_text(".console-lines").count("Programm gestartet")
    check("world reloads with the image and stays healthy", eventually(lambda: "Schritt 0" in page.inner_text(".mw-info") and "Traceback" not in page.inner_text(".console-lines"), 40000), page.inner_text(".console-lines")[-300:])

    # --- english UI creates the english task texts
    page.locator(".menu-button", has_text="Deutsch").click()
    page.get_by_role("menuitemradio", name="English").click()
    page.locator(".menu-button", has_text="Project").first.click()
    page.get_by_role("menuitem", name="New project").click()
    d = page.locator("dialog[open]")
    d.get_by_label("Project name").fill("Coins")
    d.get_by_label("Collect coins", exact=False).check()
    d.get_by_role("button", name="Create").click()
    page.wait_for_selector("dialog[open]", state="detached")
    check("english task texts", eventually(lambda: "Tasks (0/5)" in page.locator(".tasks").inner_text() and "Change the player's speed" in page.locator(".tasks").inner_text(), 10000), page.locator(".tasks").inner_text() if page.locator(".tasks").count() else "no panel")

    check("no page errors", not [e for e in errors if "Failed to load resource" not in e], errors[:5])
    browser.close()

print("\nFAILED: " + ", ".join(failures) if failures else "\nall passed")
sys.exit(1 if failures else 0)

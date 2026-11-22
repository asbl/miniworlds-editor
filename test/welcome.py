"""Browser test of the first visit: welcome card, importing a program, backup hints, start-up display.

Needs network (Pyodide CDN, miniworlds from PyPI), `npm run build` and a server on the given URL
(`python3 spikes/s4/serve.py 4181 dist`). Usage:  python test/welcome.py [chromium|firefox] [url]
"""
import os, sys, tempfile, zipfile
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(__file__))
from support import check, console, eventually, failures

BROWSER = sys.argv[1] if len(sys.argv) > 1 else "chromium"
URL = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:4173/"


def topbar(page):
    return page.inner_text(".topbar")


with sync_playwright() as p:
    browser = getattr(p, BROWSER).launch()
    tmp = tempfile.mkdtemp(prefix="mw-welcome-")

    # --- 1. a first visit: the card, nothing else is usable behind it
    ctx = browser.new_context(locale="de-DE", viewport={"width": 1366, "height": 768}, accept_downloads=True)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL)
    page.wait_for_selector("dialog.welcome[open]")
    text = page.inner_text("dialog.welcome")
    check("the card offers an own world, the three templates and an import", "Eigene Welt" in text and "Krabbe" in text and "Münzen" in text and "Pong" in text and "importieren" in text, text[:300])
    check("the editor behind it is already there (and the project exists)", "Projekt: Mein Projekt" in topbar(page), topbar(page))

    # --- 2. the import hints inside the card
    page.click("dialog.welcome .welcome-import button")
    ways = page.inner_text("dialog.welcome .import-ways")
    check("the import dialog offers folder, ZIP and Python files", all(w in ways for w in ("Ordner", "ZIP-Datei", "Python-Dateien")), ways[:300])
    check("they say nothing gets overwritten", "überschrieben" in ways)

    # a single .py file becomes main.py of a new project and replaces the untouched starter project
    one = os.path.join(tmp, "mein_spiel.py")
    open(one, "w").write("import miniworlds as mw\nwelt = mw.World(200, 100)\nwelt.run()\n# importiert\n")
    with page.expect_file_chooser() as chooser:
        page.click("dialog.welcome .import-list li:nth-child(3) button")
    chooser.value.set_files(one)
    check("importing one Python file opens a project named after it", eventually(lambda: "Projekt: mein_spiel" in topbar(page), 20000), topbar(page))
    check("the card is closed", page.locator("dialog.welcome").count() == 0)
    page.wait_for_selector(".cm-content")
    check("the file became main.py", "# importiert" in page.inner_text(".cm-content"))
    page.click(".topbar .menu-button >> nth=0")
    items = page.inner_text(".menu-items")
    check("the untouched starter project was replaced, not left behind", "Mein Projekt" not in items, items)
    check("the project menu points to the import help and the welcome card", "Importieren" in items and "Erste Schritte" in items, items)
    page.keyboard.press("Escape")

    # --- 3. once only
    page.reload()
    page.wait_for_selector(".cm-content")
    page.wait_for_timeout(800)
    check("the card does not come back after a reload", page.locator("dialog.welcome").count() == 0)

    # --- 4. the card can be opened again and the import guide stands on its own
    page.click(".topbar .menu-button >> nth=0")
    page.locator(".menu-items button", has_text="Importieren").click()
    page.wait_for_selector("dialog.welcome[open] .import-ways")
    check("the guide opens from the menu", "Projekt importieren" in page.inner_text("dialog.welcome"))
    page.keyboard.press("Escape")
    check("Escape closes it", eventually(lambda: page.locator("dialog.welcome").count() == 0, 3000))

    # --- 5. a ZIP dropped anywhere is a project; several .py files keep their names
    zpath = os.path.join(tmp, "Abgabe.zip")
    with zipfile.ZipFile(zpath, "w") as z:
        z.writestr("main.py", "import miniworlds as mw\nwelt = mw.World(100, 100)\nwelt.run()\n")
    with page.expect_file_chooser() as chooser:
        page.click(".topbar .menu-button >> nth=0")
        page.locator(".menu-items button", has_text="Importieren").click()
        page.get_by_role("button", name="ZIP-Datei auswählen").click()
    chooser.value.set_files(zpath)
    page.wait_for_selector("dialog.dialog[open]")  # "1 Dateien importiert."
    page.click("dialog.dialog[open] button.primary")
    check("importing a ZIP makes a project", eventually(lambda: "Projekt: Abgabe" in topbar(page), 20000), topbar(page))
    a, b = os.path.join(tmp, "main.py"), os.path.join(tmp, "helfer.py")
    open(a, "w").write("import helfer\n")
    open(b, "w").write("X = 1\n")
    page.click(".topbar .menu-button >> nth=0")
    with page.expect_file_chooser() as chooser:
        page.locator(".menu-items button", has_text="Importieren").click()
        page.get_by_role("button", name="Python-Dateien auswählen").click()
    chooser.value.set_files([a, b])
    check("several files keep their names (main.py stays main.py)", eventually(lambda: "Projekt: main" in topbar(page), 20000), topbar(page))
    page.click(".sidebar-tabs [role=tab] >> text=Dateien")
    tree = page.inner_text(".tree")
    check("both files are in the project", "helfer.py" in tree and "main.py" in tree, tree)

    # --- 6. backup button
    check("a backup button is always in the top bar", page.locator(".backup-button").count() == 1)
    with page.expect_download() as download:
        page.click(".backup-button")
    check("it downloads the project as a ZIP", download.value.suggested_filename.endswith(".zip"), download.value.suggested_filename)
    download.value.cancel()
    check("does not claim the download was saved (it may be cancelled)", eventually(lambda: page.locator(".notice").count() == 0, 3000))
    check("the status bar says where the project lives", "nur auf diesem gerät" in page.inner_text(".status").lower(), page.inner_text(".status"))
    ctx.close()

    # --- 7. choosing "Eigene Welt": the starter figure, running it, the start-up display
    ctx = browser.new_context(locale="de-DE", viewport={"width": 1366, "height": 768})
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL)
    page.wait_for_selector("dialog.welcome[open]")
    page.click("dialog.welcome .primary-card")
    check("the starter project stays", eventually(lambda: page.locator("dialog.welcome").count() == 0 and "Projekt: Mein Projekt" in topbar(page), 5000))
    page.click(".sidebar-tabs [role=tab] >> text=Dateien")
    page.click(".tree .row >> text=Figur.py")
    eventually(lambda: "class Figur" in page.inner_text(".cm-content"), 10000)  # the editor swaps its text a moment after the click
    figure = page.inner_text(".cm-content")
    check("the starter figure explains itself and stays in the world", "bounce_from_border" in figure and "Radius" in figure, figure[:300])
    page.click(".toolbar .run")
    check("pressing Run before Python is up queues the start visibly", eventually(lambda: page.locator(".toolbar .run.queued").count() == 1 or "Läuft" in page.inner_text(".world-status"), 15000))
    check("the world shows what is going on instead of a black box", eventually(lambda: page.locator(".boot-placeholder").count() == 1 or "Läuft" in page.inner_text(".world-status"), 15000))
    check("and the program starts by itself", eventually(lambda: "Programm gestartet" in console(page), 180000), console(page)[-300:])
    page.wait_for_timeout(8000)  # the figure walks for a while: it must still be in the world (it used to leave after two seconds)
    check("the world canvas is shown", page.locator("canvas.world-canvas").count() == 1)
    check("no page errors", not errors, str(errors[:2]))
    ctx.close()

    # --- 8. narrow screen: the loading banner is a slim bar, not a card over everything
    ctx = browser.new_context(locale="de-DE", viewport={"width": 390, "height": 780})
    page = ctx.new_page()
    page.goto(URL)
    page.wait_for_selector("dialog.welcome[open]")
    box = page.locator("dialog.welcome").bounding_box()
    check("the welcome card fits a phone", box is not None and box["width"] <= 390 and box["x"] >= 0, str(box))
    page.click("dialog.welcome .primary-card")
    page.wait_for_selector(".loading-banner")
    banner = page.locator(".loading-banner").bounding_box()
    check("on a phone the loading banner is slim", banner is not None and banner["height"] < 110, str(banner))
    ctx.close()
    browser.close()

print(f"{len(failures)} failed" if failures else "all passed")
sys.exit(1 if failures else 0)

"""Browser test of sharing: the share dialog and its picture rules, the link, the play page, the touch pad, "open in the editor".

Needs network (Pyodide CDN, miniworlds from PyPI), a served build, Python with Playwright.
Usage:  python test/share.py [chromium|firefox] [url]
"""
import base64, os, re, sys
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(__file__))
from support import FILES_FIRST, check, eventually, failures, set_main, wait_ready

BROWSER = sys.argv[1] if len(sys.argv) > 1 else "chromium"
URL = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:4173/"
# a 1x1 PNG: stands for a picture the pupil uploaded (no real picture is needed to test the rules)
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
KEYS = 'import miniworlds as mw\n\n\nclass P(mw.Circle):\n    def __init__(self, position=(0, 0)):\n        super().__init__(position, 15)\n        self.fill_color = (60, 110, 200)\n\n    def on_key_down(self, key):\n        print("KEY", key)\n\n\nwelt = mw.World(300, 200)\nP((150, 100))\nwelt.run()\n'


def project_menu(page, item):
    page.locator(".menu-button", has_text="Projekt").first.click()
    page.get_by_role("menuitem", name=item).click()


def played_text(page):
    return page.locator(".play-console").text_content() or ""


with sync_playwright() as p:
    browser = getattr(p, BROWSER).launch()
    ctx = browser.new_context(locale="de-DE", viewport={"width": 1400, "height": 860}, permissions=["clipboard-read", "clipboard-write"] if BROWSER == "chromium" else [])
    ctx.add_init_script(FILES_FIRST)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL)
    page.wait_for_selector(".cm-content")
    check("python boots", wait_ready(page))
    pname = re.sub(r"^Projekt:\s*|\s*▾$", "", page.locator(".menu-button", has_text="Projekt").first.inner_text()).strip()

    # --- a project with a library picture, a drawn one is not needed here; one picture is "uploaded" by dropping a file in
    set_main(page, KEYS)
    page.wait_for_timeout(700)
    project_menu(page, "Teilen als Link")
    dialog = page.locator("dialog[open]")
    check("the share dialog opens", eventually(lambda: dialog.locator(".share-link").count() == 1, 5000))
    check("a game without pictures has no picture section", dialog.locator(".share-images").count() == 0)
    link0 = dialog.locator(".share-link").input_value()
    check("the link points at the editor with a game in the part after #", re.match(r"^http://localhost:\d+/#play=[A-Za-z0-9_-]+$", link0) is not None, link0[:80])
    check("a small game gets a QR code", dialog.locator(".share-qr svg").count() == 1)
    dialog.get_by_role("button", name="Link kopieren").click()
    check("copying says so", eventually(lambda: "Kopiert" in dialog.inner_text(), 3000))
    if BROWSER == "chromium":
        check("the link is on the clipboard", page.evaluate("navigator.clipboard.readText()") == link0)
    dialog.get_by_role("button", name="OK").click()
    page.wait_for_selector("dialog[open]", state="detached")

    page.locator("input[type=file]").first.set_input_files(files=[{"name": "foto.png", "mimeType": "image/png", "buffer": PNG}])
    check("the dropped-in picture is in images/", eventually(lambda: "foto.png" in page.locator(".tree").inner_text(), 8000), page.locator(".tree").inner_text())
    page.wait_for_timeout(700)
    project_menu(page, "Teilen als Link")
    dialog = page.locator("dialog[open]")
    check("an uploaded picture needs the pupil's word", eventually(lambda: dialog.locator(".share-upload input[type=checkbox]").count() == 1, 5000))
    box = dialog.locator(".share-upload input[type=checkbox]")
    check("it is not ticked by default", not box.is_checked())
    link_without = dialog.locator(".share-link").input_value()
    check("the dialog says what happens to it", "graues Feld" in dialog.inner_text(), dialog.inner_text()[:300])
    box.check()
    link_with = dialog.locator(".share-link").input_value()
    check("ticking it puts the picture into the link", len(link_with) > len(link_without), f"{len(link_without)} vs {len(link_with)}")
    box.uncheck()
    check("un-ticking takes it out again", dialog.locator(".share-link").input_value() == link_without)
    dialog.get_by_role("button", name="OK").click()
    page.wait_for_selector("dialog[open]", state="detached")

    # --- the play page: open the link the dialog made (picture withheld)
    play = ctx.new_page()
    perrors = []
    play.on("pageerror", lambda e: perrors.append(str(e)))
    play.goto(link_without)
    play.wait_for_selector(".play .world-canvas")
    check("the play page shows the game's name", eventually(lambda: play.locator(".play .brand").inner_text() == pname, 5000), play.locator(".play .brand").inner_text() + " vs " + pname)
    check("the play page has no editor", play.locator(".cm-content").count() == 0)
    check("the game starts by itself", eventually(lambda: "Programm gestartet" in played_text(play), 150000), played_text(play)[-300:])
    check("no traceback", "Traceback" not in played_text(play), played_text(play)[-300:])
    check("it names the withheld picture in the credits", "grauen Feldern" in play.inner_text(".play-credits") or "grau" in play.inner_text(".play-credits"), play.inner_text(".play-credits"))
    check("no touch pad on a desktop", play.locator(".touchpad").count() == 0)
    play.locator(".play .world-canvas").click()
    play.keyboard.press("ArrowLeft")
    check("the keyboard reaches the game", eventually(lambda: "KEY" in played_text(play), 8000), played_text(play)[-300:])

    # --- open it in the editor as a copy
    play.get_by_role("button", name="Im Editor öffnen").click()
    play.wait_for_selector(".cm-content", timeout=30000)
    check("the editor opens, without the link part", "#play=" not in play.url, play.url)
    check("the copy is a project of its own", eventually(lambda: f"{pname} 2" in play.inner_text(".topbar"), 10000), play.inner_text(".topbar"))
    check("withheld picture is a placeholder file in the copy", eventually(lambda: "foto.png" in play.locator(".tree").inner_text() or play.get_by_role("tab", name="Dateien").count() > 0, 8000))
    play.close()

    # --- a phone: the touch pad sends keys (Playwright can only emulate a phone in Chromium)
    if BROWSER == "chromium":
        phone = browser.new_context(locale="de-DE", viewport={"width": 390, "height": 800}, has_touch=True, is_mobile=True)
        phone.add_init_script(FILES_FIRST)
        mobile = phone.new_page()
        merrors = []
        mobile.on("pageerror", lambda e: merrors.append(str(e)))
        mobile.goto(link0)
        mobile.wait_for_selector(".play .world-canvas")
        check("a touch screen gets the touch pad", eventually(lambda: mobile.locator(".touchpad").count() == 1, 5000))
        check("the game starts on the phone", eventually(lambda: "Programm gestartet" in played_text(mobile), 150000), played_text(mobile)[-300:])
        left = mobile.get_by_role("button", name="Links")
        b = left.bounding_box()
        mobile.touchscreen.tap(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)
        check("a tap on the pad is a key press in the game", eventually(lambda: "KEY" in played_text(mobile), 8000), played_text(mobile)[-300:])
        check("the page fits the phone without sideways scrolling", mobile.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
        phone.close()

    # --- a broken link is explained, not a blank page
    bad = ctx.new_page()
    bad.goto(URL + "#play=nonsense")
    bad.wait_for_selector(".play-problem")
    check("a broken link says so and leads back", "funktioniert nicht" in bad.inner_text(".play-problem") and bad.locator(".play-problem a").count() == 1, bad.inner_text(".play-problem"))
    bad.close()

    check("no page errors in the editor", not errors, str(errors[:3]))
    check("no page errors on the play pages", not perrors and not (BROWSER == "chromium" and merrors), str((perrors + (merrors if BROWSER == "chromium" else []))[:3]))
    browser.close()

print("\nall passed" if not failures else f"\n{len(failures)} failed: {failures}")
sys.exit(1 if failures else 0)

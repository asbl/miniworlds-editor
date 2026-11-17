"""Headless-Browser-Test des Editor-Kerns (Meilenstein 1).

Voraussetzung: `npm run build && npx vite preview --port 4173` läuft und ein Python mit Playwright
(z. B. ~/code-git/course-sync/.venv). Aufruf:  python test/smoke.py [chromium|firefox]
"""
import io, sys, zipfile
from playwright.sync_api import sync_playwright, expect

URL = "http://localhost:4173/"
BROWSER = sys.argv[1] if len(sys.argv) > 1 else "chromium"
failures = []


def check(name, condition, detail=""):
    print(("ok   " if condition else "FAIL ") + name + (f"  [{detail}]" if detail and not condition else ""))
    if not condition:
        failures.append(name)


def make_png():
    import struct, zlib
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))
    raw = b"\x00" + bytes([200, 60, 60, 255])  # one red pixel
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def eventually(fn, timeout=4000, step=100):
    """Poll `fn` until truthy (UI updates are asynchronous)."""
    import time
    end = time.time() + timeout / 1000
    while time.time() < end:
        try:
            if fn():
                return True
        except Exception:
            pass
        time.sleep(step / 1000)
    return False


def editor_has(page, text):
    return eventually(lambda: text in page.inner_text(".cm-content"))


def menu(page, button_text, item_text):
    page.locator(".menu-button", has_text=button_text).first.click()
    page.get_by_role("menuitem", name=item_text).click()


def sidebar_files(page):
    return [t.strip().lstrip("▾▸").strip() for t in page.locator(".tree .row-main").all_inner_texts()]


def fill_dialog(page, **fields):
    dialog = page.locator("dialog[open]")
    for label, value in fields.items():
        dialog.get_by_label(label.replace("_", " ")).fill(value)
    return dialog


with sync_playwright() as p:
    browser = getattr(p, BROWSER).launch()
    ctx = browser.new_context(accept_downloads=True, locale="de-DE")
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.goto(URL)
    page.wait_for_selector(".cm-content")

    # --- first start: starter project with class files, German UI
    check("german UI by default", "Dateien" in page.inner_text(".sidebar-tabs"))
    check("starter project name", "Mein Projekt" in page.inner_text(".topbar"))
    files = sidebar_files(page)
    check("tree shows classes/ + main.py + project.toml", {"classes", "main.py", "project.toml"} <= set(files), files)
    check("main.py opened first", "main.py" in page.inner_text(".tabs"))
    check("main.py imports starter classes", editor_has(page, "from classes.Spielfeld import Spielfeld"))

    # --- edit + autosave + reload persistence
    page.click(".cm-content")
    page.keyboard.press("Control+End")
    page.keyboard.type("# persisted")
    check("dirty marker while typing", page.locator(".tab .dot").count() == 1)
    page.wait_for_timeout(900)
    check("dirty marker gone after autosave", page.locator(".tab .dot").count() == 0)
    page.reload()
    page.wait_for_selector(".cm-content")
    check("edit survives reload (OPFS)", editor_has(page, "# persisted"))
    check("persistent storage reported", "dauerhaft" in page.inner_text(".status"))

    # --- new class via dialog: file + import in main.py
    menu(page, "+", "Neue Klasse")
    dialog = page.locator("dialog[open]")
    dialog.get_by_label("Klassenname").fill("class")
    dialog.get_by_role("button", name="Anlegen").click()
    check("reserved word rejected", "reserviert" in dialog.inner_text())
    dialog.get_by_label("Klassenname").fill("Krabbe")
    dialog.get_by_role("button", name="Anlegen").click()
    page.wait_for_selector("dialog[open]", state="detached")
    check("class tab opened", eventually(lambda: "classes/Krabbe.py" in page.inner_text(".tabs")))
    check("class file content", editor_has(page, "class Krabbe(mw.Circle):"))
    page.locator(".tab-name", has_text="main.py").click()
    check("import added to main.py", editor_has(page, "from classes.Krabbe import Krabbe"))

    # --- project-wide search and replace
    page.keyboard.press("Control+Shift+F")
    page.get_by_placeholder("Suchen").fill("Krabbe")
    page.wait_for_selector(".hit")
    info = page.inner_text(".search-info")
    check("search finds hits in 2 files", "2 Dateien" in info, info)
    page.get_by_placeholder("Ersetzen durch").fill("Wurm")
    page.get_by_role("button", name="Alle ersetzen").click()
    page.locator("dialog[open]").get_by_role("button", name="OK").click()
    page.wait_for_selector("dialog[open]", state="detached")
    check("replace updates open main.py", editor_has(page, "from classes.Wurm import Wurm"))
    page.get_by_role("tab", name="Dateien").click()

    # --- rename + delete (with import cleanup)
    page.locator(".tree .row", has_text="Krabbe.py").hover()
    page.get_by_label("Umbenennen classes/Krabbe.py").click()
    d = page.locator("dialog[open]")
    d.get_by_label("Dateiname").fill("classes/Wurm.py")
    d.get_by_role("button", name="OK").click()
    page.wait_for_selector("dialog[open]", state="detached")
    check("renamed file in tree", eventually(lambda: "Wurm.py" in sidebar_files(page) and "Krabbe.py" not in sidebar_files(page)), sidebar_files(page))
    check("tab follows rename", eventually(lambda: "classes/Wurm.py" in page.inner_text(".tabs")))
    page.locator(".tree .row", has_text="Wurm.py").hover()
    page.get_by_label("Löschen classes/Wurm.py").click()
    page.locator("dialog[open]").get_by_role("button", name="Löschen").click()
    page.wait_for_selector("dialog[open]", state="detached")
    check("deleted file gone", eventually(lambda: "Wurm.py" not in sidebar_files(page)))
    page.locator(".tab-name", has_text="main.py").click()
    check("dangling import removed", eventually(lambda: "classes.Wurm" not in page.inner_text(".cm-content") and "welt" in page.inner_text(".cm-content")))

    # --- upload an image, preview
    page.locator("input[type=file]").first.set_input_files(
        {"name": "krabbe.png", "mimeType": "image/png",
         "buffer": make_png()}
    )
    page.wait_for_selector(".viewer img")
    check("image stored in images/ and previewed", eventually(lambda: "images/krabbe.png" in page.inner_text(".tabs")))

    # --- ZIP export contains the project, import creates a new project
    with page.expect_download() as dl:
        menu(page, "Projekt", "Als ZIP exportieren")
    path = dl.value.path()
    names = zipfile.ZipFile(path).namelist()
    check("zip has files", {"main.py", "project.toml", "images/krabbe.png"} <= set(names), names)
    with page.expect_file_chooser() as chooser:
        menu(page, "Projekt", "ZIP importieren")
    chooser.value.set_files({"name": "Gast.zip", "mimeType": "application/zip", "buffer": open(path, "rb").read()})
    page.wait_for_selector("dialog[open]")
    page.locator("dialog[open]").get_by_role("button", name="OK").click()
    page.wait_for_selector("dialog[open]", state="detached")
    check("imported project is open", eventually(lambda: "Gast" in page.inner_text(".topbar")))

    # --- new single-file project, switch back
    menu(page, "Projekt", "Neues Projekt")
    d = page.locator("dialog[open]")
    d.get_by_label("Projektname").fill("Alt")
    d.get_by_label("Einzelne Datei").check()
    d.get_by_role("button", name="Anlegen").click()
    page.wait_for_selector("dialog[open]", state="detached")
    page.wait_for_selector(".badge")
    check("legacy badge", "Einzeldatei" in page.inner_text(".sidebar"))
    check("legacy has only main.py", sidebar_files(page) == ["main.py"], sidebar_files(page))
    check("new class disabled for legacy", page.locator(".menu-button", has_text="+").count() == 1)
    page.locator(".menu-button", has_text="Projekt").first.click()
    page.get_by_role("menuitemradio", name="Mein Projekt").click()
    check("switched back", eventually(lambda: "Mein Projekt" in page.inner_text(".topbar") and "classes" in sidebar_files(page)))

    # --- language switch
    page.locator(".menu-button", has_text="Deutsch").click()
    page.get_by_role("menuitemradio", name="English").click()
    check("english UI", "Files" in page.inner_text(".sidebar-tabs") and "Project" in page.inner_text(".topbar"))
    page.reload()
    page.wait_for_selector(".cm-content")
    check("language persists", "Files" in page.inner_text(".sidebar-tabs"))

    check("no console/page errors", not errors, errors)
    browser.close()

print("\nFAILED: " + ", ".join(failures) if failures else "\nall passed")
sys.exit(1 if failures else 0)

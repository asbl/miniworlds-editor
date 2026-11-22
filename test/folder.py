"""Browser test: importing a student's folder (picker and drag & drop).

Needs `npm run build && npx vite preview --port 4173` and Python with Playwright. Usage:  python test/folder.py [chromium|firefox]
"""
import os, sys, tempfile
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
from support import SEEN_WELCOME, check, eventually

URL = "http://localhost:4173/"
BROWSER = sys.argv[1] if len(sys.argv) > 1 else "chromium"

root = tempfile.mkdtemp(prefix="mw-folder-")
folder = os.path.join(root, "Meine Krabbe")
for rel, data in {
    "main.py": b'print("aus dem Ordner")\n',
    "images/crab.png": b"\x89PNG\r\n",
    "sounds/plop.ogg": b"OggS",
    "__pycache__/main.cpython-312.pyc": b"junk",
    ".idea/workspace.xml": b"<x/>",
}.items():
    path = os.path.join(folder, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "wb").write(data)
empty = os.path.join(root, "Ohne main")
os.makedirs(empty)
open(os.path.join(empty, "notizen.txt"), "w").write("nur Notizen")


def project_files(page):
    page.get_by_role("tab", name="Dateien").click()
    return [t.strip() for t in page.locator(".tree .row-main").all_inner_texts()]


with sync_playwright() as p:
    browser = getattr(p, BROWSER).launch()
    ctx = browser.new_context(locale="de-DE")
    page = ctx.new_page()
    page.add_init_script(SEEN_WELCOME)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL)
    page.wait_for_selector(".cm-content")

    # ---- folder picker
    page.get_by_role("button", name="Projekt:").click()
    check("the project menu offers import", page.get_by_role("menuitem", name="Importieren").count() + page.locator(".menu-items button", has_text="Importieren").count() >= 1)
    page.keyboard.press("Escape")
    page.locator("input[webkitdirectory]").set_input_files(folder)
    check("the folder becomes a project of the same name", eventually(lambda: "Projekt: Meine Krabbe" in page.inner_text(".topbar"), 20000), page.inner_text(".topbar"))
    check("without a dialog in the way", page.locator("dialog[open]").count() == 0)
    files = project_files(page)
    check("with its files", any("main.py" in f for f in files) and any("images" in f for f in files), str(files))
    check("without caches and IDE files", not any("pycache" in f or ".idea" in f for f in files), str(files))
    page.locator(".tree .row-main", has_text="main.py").click()
    check("main.py has the content", eventually(lambda: "aus dem Ordner" in page.inner_text(".cm-content"), 10000))

    # ---- a folder without main.py: project is made, with a hint
    page.locator("input[webkitdirectory]").set_input_files(empty)
    check("a folder without main.py explains what to do", eventually(lambda: "keine main.py" in page.inner_text("dialog[open]"), 20000))
    page.locator("dialog[open]").get_by_role("button", name="OK").click()

    # ---- the same folder again: a second project, nothing overwritten
    page.locator("input[webkitdirectory]").set_input_files(folder)
    check("importing it again makes a new project", eventually(lambda: "Projekt: Meine Krabbe 2" in page.inner_text(".topbar"), 20000), page.inner_text(".topbar"))

    # ---- drag & drop (real drag with a directory path, Chromium only)
    if BROWSER == "chromium":
        cdp = ctx.new_cdp_session(page)
        data = {"items": [], "files": [folder], "dragOperationsMask": 1}
        for kind in ("dragEnter", "dragOver", "drop"):
            cdp.send("Input.dispatchDragEvent", {"type": kind, "x": 400, "y": 300, "data": data})
        check("dropping the folder imports it too", eventually(lambda: "Projekt: Meine Krabbe 3" in page.inner_text(".topbar"), 20000), page.inner_text(".topbar"))

    if BROWSER == "chromium":  # also on the top bar, outside the project area
        for kind in ("dragEnter", "dragOver", "drop"):
            cdp.send("Input.dispatchDragEvent", {"type": kind, "x": 400, "y": 15, "data": data})
        check("a folder dropped on the top bar is imported too", eventually(lambda: "Projekt: Meine Krabbe 4" in page.inner_text(".topbar"), 20000), page.inner_text(".topbar"))

    # several folders at once: one project each; loose files go to the first
    if BROWSER == "chromium":
        second = os.path.join(root, "Zweite Welt")
        os.makedirs(second)
        open(os.path.join(second, "main.py"), "w").write("x = 2\n")
        loose = os.path.join(root, "extra.txt")
        open(loose, "w").write("lose Datei")
        data = {"items": [], "files": [second, empty, loose], "dragOperationsMask": 1}
        for kind in ("dragEnter", "dragOver", "drop"):
            cdp.send("Input.dispatchDragEvent", {"type": kind, "x": 600, "y": 400, "data": data})
        check("two dropped folders become two projects", eventually(lambda: page.locator("dialog[open]").count() == 1, 20000))  # "Ohne main" has no main.py
        page.locator("dialog[open]").get_by_role("button", name="OK").click()
        page.get_by_role("button", name="Projekt:").click()
        items = [i.strip(" ✓\n") for i in page.locator(".menu-items button").all_inner_texts()]
        page.keyboard.press("Escape")
        check("each has its own project", "Zweite Welt" in items and "Ohne main" in items, str(items))

    check("no page errors", not errors, str(errors))
    browser.close()

from support import failures
sys.exit(1 if failures else 0)

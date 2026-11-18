"""Browser test of the embed API (milestone 5): an iframe on another origin loads, edits and fetches a project via postMessage.

Needs network (Pyodide, miniworlds), `npm run build` first and Python with Playwright.
Usage:  python test/embed.py [chromium|firefox]
"""
import json, os, shutil, sys
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
from support import Server, check, copy_dist, eventually, failures

BROWSER = sys.argv[1] if len(sys.argv) > 1 else "chromium"
EDITOR = "http://localhost:4181"
PARENT = "http://127.0.0.1:4181/parent.html"  # another origin than the editor (localhost), served by the same test server
PAGE = f"""<!doctype html><body><iframe id="f" src="{EDITOR}/?embed=1" width="1100" height="750"></iframe>
<script>
window.msgs = []
addEventListener('message', e => msgs.push({{ origin: e.origin, data: e.data }}))
window.send = m => document.getElementById('f').contentWindow.postMessage({{ app: 'miniworlds-editor', ...m }}, '{EDITOR}')
</script></body>"""

dist = copy_dist()
open(os.path.join(dist, "parent.html"), "w").write(PAGE)
open(os.path.join(dist, "parent-submit.html"), "w").write(PAGE.replace("?embed=1", "?embed=1&submit=1"))


def allow(origins):
    cfg = {} if origins is None else {"embedOrigins": origins}
    json.dump(cfg, open(os.path.join(dist, "config.json"), "w"))


allow(["http://127.0.0.1:4181"])  # embedding is opt-in: the parent page of this test is listed
server = Server(dist, 4181).start()


def messages(page, type_=None):
    out = [m["data"] for m in page.evaluate("msgs")]
    return [m for m in out if type_ is None or m.get("type") == type_]


def open_parent(browser):
    page = browser.new_page()
    page.goto(PARENT)
    return page


with sync_playwright() as p:
    browser = getattr(p, BROWSER).launch()
    page = open_parent(browser)
    frame = page.frame_locator("#f")
    check("editor announces itself", eventually(lambda: messages(page, "ready"), 30000))

    page.evaluate("""send({ type: 'load', id: 'l1', lang: 'en', files: {
        'main.py': 'print("aus moodle")\\n', 'classes/Hallo.py': 'class Hallo:\\n    pass\\n', 'images/p.png': { base64: 'iVBORw0KGgo=' } } })""")
    check("load is acknowledged with its id", eventually(lambda: any(m.get("id") == "l1" for m in messages(page, "loaded")), 20000))
    check("files are shown", eventually(lambda: frame.locator(".tree .row-main", has_text="main.py").count() > 0 and frame.locator(".tree", has_text="Hallo.py").count() > 0, 20000))
    check("project name chrome is hidden (no project menu)", frame.locator(".topbar", has_text="Project").count() == 0 and frame.locator(".topbar", has_text="Projekt").count() == 0)
    check("language from the page", "English" in frame.locator(".topbar").inner_text())

    frame.locator(".tree .row-main", has_text="main.py").click()
    check("editor shows the loaded code", eventually(lambda: "aus moodle" in frame.locator(".cm-content").inner_text(), 10000))
    frame.locator(".cm-content").click()
    page.keyboard.press("Control+End")
    page.keyboard.insert_text("# bearbeitet")
    check("change names the edited file (a hint, no content)", eventually(lambda: any(m["paths"] == ["main.py"] and "files" not in m for m in messages(page, "change")), 15000))

    page.evaluate("send({ type: 'get-files', id: 'g1' })")
    check("get-files answers with all files", eventually(lambda: any(m.get("id") == "g1" and "# bearbeitet" in m["files"]["main.py"] and m["files"]["images/p.png"] == {"base64": "iVBORw0KGgo="} for m in messages(page, "files")), 15000))

    page.evaluate("send({ type: 'load', id: 'bad', files: { '../evil.py': 'x' } })")
    check("unsafe path is refused", eventually(lambda: any(m.get("id") == "bad" for m in messages(page, "error")), 10000))
    page.evaluate("send({ type: 'load', id: 'l2', files: { 'main.py': 'print(2)\\n' } })")
    check("a second load replaces the project", eventually(lambda: any(m.get("id") == "l2" for m in messages(page, "loaded")), 10000) and eventually(lambda: frame.locator(".tree", has_text="Hallo.py").count() == 0, 10000))

    origins = {m["origin"] for m in page.evaluate("msgs")}
    check("answers come from the editor's origin only", origins == {EDITOR}, str(origins))

    # the visitor's own project storage must not be reachable through the embed
    opfs = frame.locator("body").evaluate("navigator.storage.getDirectory().then(d => d.getDirectoryHandle('projects')).then(() => 'exists', () => 'none')")
    check("embedded project is not stored in the visitor's projects", opfs == "none", opfs)

    # run inside the embed
    check("world boots in the embed", eventually(lambda: "Ready" in frame.locator(".world-status").inner_text(), 150000))
    frame.locator(".toolbar .run").click()
    check("program runs in the embed", eventually(lambda: "2" in frame.locator(".console-lines").inner_text(), 150000))
    page.close()

    # ---- the "Hand in" button (only with ?submit=1) sends all files to the page
    page = browser.new_page()
    page.goto("http://127.0.0.1:4181/parent-submit.html")
    frame = page.frame_locator("#f")
    check("editor announces itself (submit page)", eventually(lambda: messages(page, "ready"), 30000))
    page.evaluate("send({ type: 'load', id: 's1', lang: 'de', files: { 'main.py': 'print(1)\\n' } })")
    check("a hand-in button is offered", eventually(lambda: frame.get_by_role("button", name="Abgeben").count() == 1, 20000))
    frame.get_by_role("button", name="Abgeben").click()
    check("hand-in sends the files to the page", eventually(lambda: any(m["files"].get("main.py") == "print(1)\n" for m in messages(page, "submit")), 15000), str(messages(page, "submit")))
    check("the button confirms", eventually(lambda: frame.get_by_role("button", name="Abgegeben").count() == 1, 5000))
    page.close()
    page = open_parent(browser)
    check("no hand-in button without ?submit=1", eventually(lambda: messages(page, "ready"), 30000) and page.frame_locator("#f").get_by_role("button", name="Abgeben").count() == 0 and page.frame_locator("#f").get_by_role("button", name="Hand in").count() == 0)
    page.close()

    # ---- opt-in: unlisted, damaged or missing configuration means nobody ----
    for label, origins in (("another origin listed", ["https://moodle.example"]), ("no embedOrigins entry", None), ("embedOrigins is a string", "http://127.0.0.1:4181")):
        allow(origins)
        page = open_parent(browser)
        page.wait_for_timeout(3000)
        page.evaluate("send({ type: 'get-files', id: 'x' })")
        page.wait_for_timeout(1500)
        check(f"unlisted page receives nothing ({label})", messages(page) == [], str(messages(page)))
        page.close()
    allow(["*"])
    page = open_parent(browser)
    check("explicit * lets any page embed", eventually(lambda: messages(page, "ready"), 30000))
    browser.close()

server.stop()
shutil.rmtree(dist, ignore_errors=True)
print("\nall passed" if not failures else f"\nFAILED: {failures}")
sys.exit(1 if failures else 0)

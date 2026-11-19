"""Browser test of "work together": two browsers in one room (real relay), typing at the same time, files, cursors, rejoin, leaving.

Needs a build (npm run build), Node, Python with Playwright. No network: the editor's Python is not started.
Usage:  python test/collab.py [chromium|firefox]
"""
import json, os, re, socket, struct, subprocess, sys, time, zlib
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(__file__))
from support import FILES_FIRST, ROOT, Server, check as _check, copy_dist, eventually, failures

trail = []


def check(name, *a, **k):
    trail.append(name)
    return _check(name, *a, **k)


BROWSER = sys.argv[1] if len(sys.argv) > 1 else "chromium"


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


web_port, relay_port, plain_port = free_port(), free_port(), free_port()
dist = copy_dist()
with open(os.path.join(dist, "config.json"), "w") as f:
    json.dump({"links": [], "collabUrl": f"ws://127.0.0.1:{relay_port}/collab"}, f)
plain = copy_dist()  # a deployment without a relay
site = Server(dist, web_port).start()
plain_site = Server(plain, plain_port).start()
relay = subprocess.Popen(
    ["node", os.path.join(ROOT, "deploy", "collab", "relay.mjs")],
    env={**os.environ, "PORT": str(relay_port), "HOST": "127.0.0.1", "COLLAB_ORIGINS": f"http://localhost:{web_port}"},
)
for _ in range(100):
    try:
        socket.create_connection(("127.0.0.1", relay_port), timeout=0.2).close()
        break
    except OSError:
        time.sleep(0.1)

URL = f"http://localhost:{web_port}/"


def editor_text(page):
    """The code in the editor without the other people's cursor flags."""
    return page.evaluate(
        "() => [...document.querySelectorAll('.cm-content .cm-line')].map((l) => { const c = l.cloneNode(true); "
        "c.querySelectorAll('.cm-ySelectionCaret, .cm-ySelectionInfo').forEach((n) => n.remove()); return c.textContent }).join('\\n')"
    )


def big_png(side=2200):
    """A picture of about 7 MB (noise with few bits, so that it hardly compresses): what a phone photo is like."""
    table = bytes(b & 0x07 for b in range(256))
    raw = b"".join(b"\x00" + os.urandom(side * 3).translate(table) for _ in range(side))
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", side, side, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 1)) + chunk(b"IEND", b"")


def stored_size(page, path):
    """Size of a file of the open project in the browser's own storage (the project folder that has it)."""
    return page.evaluate("""async (path) => {
        const root = await navigator.storage.getDirectory()
        const projects = await root.getDirectoryHandle('projects')
        const parts = path.split('/')
        for await (const [, dir] of projects.entries()) {
            try {
                let d = dir
                for (const part of parts.slice(0, -1)) d = await d.getDirectoryHandle(part)
                return (await (await d.getFileHandle(parts[parts.length - 1])).getFile()).size
            } catch (e) {}
        }
        return -1
    }""", path)


def tree(page):
    return page.locator(".tree").inner_text()


def new_person(browser, name):
    ctx = browser.new_context(locale="de-DE", viewport={"width": 1300, "height": 800}, permissions=["clipboard-read", "clipboard-write"] if BROWSER == "chromium" else [])
    ctx.add_init_script(FILES_FIRST + f";localStorage.setItem('miniworlds-editor.collabName', '{name}')")
    page = ctx.new_page()
    page.errors = []
    page.on("pageerror", lambda e: page.errors.append(str(e) + " @ " + "after: " + (trail[-1] if trail else "-")))
    return ctx, page


try:
    with sync_playwright() as p:
        browser = getattr(p, BROWSER).launch()

        # --- no relay configured: nothing about it is visible
        _, lone = new_person(browser, "Solo")
        lone.goto(f"http://localhost:{plain_port}/")
        lone.wait_for_selector(".cm-content")
        lone.wait_for_timeout(800)
        check("without a relay there is no menu entry", lone.locator(".collab-button").count() == 0)

        # --- Anna starts
        ctx_a, a = new_person(browser, "Anna")
        a.goto(URL)
        a.wait_for_selector(".cm-content")
        check("with a relay the entry appears", eventually(lambda: a.locator(".collab-button").count() == 1, 8000))
        a.locator(".tree .row-main", has_text="main.py").click()
        a.click(".cm-content")
        a.keyboard.press("Control+A")
        a.keyboard.insert_text("zeile eins\nzeile zwei\n")
        a.wait_for_timeout(700)
        a.locator(".collab-button").click()
        dialog = a.locator("dialog[open]")
        dialog.get_by_role("button", name="Gemeinsam starten").click()
        check("the invitation link appears", eventually(lambda: dialog.locator(".share-link").count() == 2, 10000))
        link = dialog.locator(".share-link").first.input_value()
        check("it is a room link", re.match(r"^http://localhost:\d+/#room=[a-z0-9]{4}-[a-z0-9]{4}\.[a-z0-9]{12}\.[a-z0-9]{12}$", link) is not None, link)
        check("it comes with a QR code", dialog.locator(".share-qr svg").count() == 1)
        check("the connection is up", eventually(lambda: "Verbunden" in dialog.inner_text(), 8000), dialog.inner_text()[:200])
        read_link = dialog.locator(".share-link").nth(1).input_value()
        check("there is a read-only link that does not hold the write key", "#watch=" in read_link and link.split(".")[1] not in read_link, read_link)
        dialog.get_by_role("button", name="Schließen").click()
        a.wait_for_selector("dialog[open]", state="detached")
        check("the button shows how many are here", eventually(lambda: "👥 1" in a.locator(".collab-button").inner_text(), 5000))
        a.locator(".tree .row-main", has_text="main.py").click()
        check("her text survived the start", "zeile eins" in editor_text(a), editor_text(a))

        # --- Ben joins by the link
        ctx_b, b = new_person(browser, "Ben")
        b.goto(link)
        b.wait_for_selector("dialog[open]")
        check("he is asked for his name first", b.locator("dialog[open] input").first.input_value() == "Ben")
        b.locator("dialog[open]").get_by_role("button", name="OK").click()
        check("his project is a new one named after the room", eventually(lambda: "Gemeinsam arbeiten" in b.locator(".menu-button", has_text="Projekt").first.inner_text(), 15000))
        b.wait_for_selector(".cm-content")
        b.locator(".tree .row-main", has_text="main.py").click()
        check("he sees Anna's code", eventually(lambda: "zeile eins" in editor_text(b), 8000), editor_text(b))
        check("the address no longer holds the room", "#room" not in b.url)
        check("both see two people", eventually(lambda: "👥 2" in a.locator(".collab-button").inner_text() and "👥 2" in b.locator(".collab-button").inner_text(), 8000))

        # --- typing at the same time ends in the same text
        a.click(".cm-content")
        a.keyboard.press("Control+Home")
        a.keyboard.insert_text("A:")
        b.click(".cm-content")
        b.keyboard.press("Control+End")
        b.keyboard.insert_text("B:")
        check("both texts agree and hold both edits", eventually(lambda: editor_text(a) == editor_text(b) and "A:zeile eins" in editor_text(a) and "B:" in editor_text(a), 8000), f"{editor_text(a)!r} / {editor_text(b)!r}")
        a.wait_for_timeout(1200)
        check("the saved state is not behind", "dirty" not in (a.locator(".status").inner_text() or "") and "Gespeichert" in a.locator(".status").inner_text(), a.locator(".status").inner_text())

        # --- the other's cursor
        b.keyboard.insert_text("x")
        check("the other person's cursor is shown with the name", eventually(lambda: a.locator(".cm-ySelectionInfo", has_text="Ben").count() >= 1, 8000))

        # --- a file added by Anna shows up for Ben
        a.locator("input[type=file]").first.set_input_files(files=[{"name": "notiz.txt", "mimeType": "text/plain", "buffer": b"hallo"}])
        check("a new file arrives at the other", eventually(lambda: "notiz.txt" in tree(b), 8000), tree(b))

        # --- a big picture is made smaller for the others
        photo = big_png()
        a.locator("input[type=file]").first.set_input_files(files=[{"name": "foto.png", "mimeType": "image/png", "buffer": photo}])
        check("the big picture arrives at the other", eventually(lambda: "foto.png" in tree(b), 30000), tree(b))
        check("it was made smaller on the way", eventually(lambda: 0 < stored_size(b, "images/foto.png") < 4_000_000, 15000), str(stored_size(b, "images/foto.png")))
        check("the original stays with its owner", stored_size(a, "images/foto.png") == len(photo), f"{stored_size(a, 'images/foto.png')} vs {len(photo)}")
        check("Anna is told", eventually(lambda: "verkleinert" in a.locator(".notice[role=alert]").inner_text() if a.locator(".notice[role=alert]").count() else False, 8000))

        # --- Ben reloads: the project joins its room again and keeps what is there
        b.reload()
        b.wait_for_selector(".cm-content")
        check("after a reload he is in the room again", eventually(lambda: "👥 2" in b.locator(".collab-button").inner_text(), 15000), b.locator(".collab-button").inner_text())
        b.locator(".tree .row-main", has_text="main.py").click()
        a.locator(".tree .row-main", has_text="main.py").click()
        check("the text is still the shared one (and not doubled)", eventually(lambda: editor_text(b) == editor_text(a), 8000) and editor_text(b).count("zeile eins") == 1, repr(editor_text(b)) + " / " + repr(editor_text(a)))

        # --- a teacher with the read-only link watches and cannot type
        ctx_t, teacher = new_person(browser, "Lehrerin")
        teacher.goto(read_link)
        teacher.wait_for_selector("dialog[open]")
        teacher.locator("dialog[open]").get_by_role("button", name="OK").click()
        check("the teacher is in the room", eventually(lambda: "👁" in teacher.locator(".collab-button").inner_text(), 15000), teacher.locator(".collab-button").inner_text())
        teacher.wait_for_selector(".cm-content")
        teacher.locator(".tree .row-main", has_text="main.py").click()
        check("she sees the code", eventually(lambda: "zeile eins" in editor_text(teacher), 8000))
        check("the editor is not editable for her", teacher.locator(".cm-content").get_attribute("contenteditable") == "false")
        before = editor_text(teacher)
        teacher.click(".cm-content")
        teacher.keyboard.insert_text("NICHT")
        teacher.wait_for_timeout(600)
        check("typing does nothing", editor_text(teacher) == before and "NICHT" not in editor_text(a))
        check("everybody counts three people", eventually(lambda: "👥 3" in a.locator(".collab-button").inner_text(), 8000), a.locator(".collab-button").inner_text())

        # --- Ben follows Anna into another file
        b.locator(".collab-button").click()
        bd = b.locator("dialog[open]")
        bd.locator(".collab-people li", has_text="Anna").get_by_role("button", name="Folgen").click()
        bd.get_by_role("button", name="Schließen").click()
        b.wait_for_selector("dialog[open]", state="detached")
        check("Ben sees that he follows", eventually(lambda: b.locator(".collab-follow-bar", has_text="Du folgst Anna").count() == 1, 5000))
        a.locator(".tree .row-main", has_text="notiz.txt").click()
        a.click(".cm-content")
        check("his editor goes where Anna is", eventually(lambda: any("notiz.txt" in t for t in b.locator(".tab.active").all_inner_texts()), 8000), str(b.locator(".tab.active").all_inner_texts()))
        b.locator(".collab-follow-bar").get_by_role("button", name="Beenden").click()
        check("following can be stopped", b.locator(".collab-follow-bar").count() == 0)

        # --- pair programming: Anna drives, Ben cannot type until he takes the wheel
        a.locator(".collab-button").click()
        ad = a.locator("dialog[open]")
        ad.get_by_role("button", name="Ich fahre").click()
        ad.get_by_role("button", name="Schließen").click()
        a.wait_for_selector("dialog[open]", state="detached")
        check("Ben is told that Anna drives", eventually(lambda: b.locator(".collab-follow-bar", has_text="Anna fährt gerade").count() == 1, 8000))
        b.locator(".tree .row-main", has_text="main.py").click()
        check("his editor is locked", eventually(lambda: b.locator(".cm-content").get_attribute("contenteditable") == "false", 5000))
        b.locator(".collab-follow-bar").get_by_role("button", name="Ich fahre").click()
        check("he takes the wheel and can type", eventually(lambda: b.locator(".cm-content").get_attribute("contenteditable") == "true", 5000))
        check("and Anna is locked now", eventually(lambda: a.locator(".collab-follow-bar", has_text="Ben fährt gerade").count() == 1, 8000))
        b.locator(".collab-button").click()
        b.locator("dialog[open]").get_by_role("button", name="Alle dürfen tippen").click()
        b.locator("dialog[open]").get_by_role("button", name="Schließen").click()
        check("everybody may type again", eventually(lambda: a.locator(".collab-follow-bar").count() == 0 and a.locator(".cm-content").get_attribute("contenteditable") == "true", 8000))

        # --- a read-only link to a room that does not exist says so
        ctx_x, stray = new_person(browser, "Fremd")
        stray.goto(URL + "#watch=nope-nope.abcdefghijkl")
        stray.wait_for_selector("dialog[open]")
        stray.locator("dialog[open]").get_by_role("button", name="OK").click()
        check("an unknown room gets its own message", eventually(lambda: stray.locator("dialog[open]").count() == 1 and "gibt es gerade nicht" in stray.locator("dialog[open]").inner_text(), 15000))
        stray.locator("dialog[open]").get_by_role("button", name="OK").click()

        # --- Anna leaves
        a.locator(".collab-button").click()
        dialog = a.locator("dialog[open]")
        dialog.get_by_role("button", name="Gemeinsames Arbeiten beenden").click()
        a.get_by_role("button", name="OK").click()
        check("she is alone again", eventually(lambda: a.locator(".collab-button").inner_text().strip() == "👥 Gemeinsam", 8000), a.locator(".collab-button").inner_text())
        a.locator(".tree .row-main", has_text="main.py").click()
        check("her text is still there", "zeile eins" in editor_text(a), editor_text(a))
        check("Ben sees her leave (the teacher is still there)", eventually(lambda: "👥 2" in b.locator(".collab-button").inner_text(), 8000), b.locator(".collab-button").inner_text())
        for who, page in (("Anna", a), ("Ben", b)):
            check(f"no script errors for {who}", not page.errors, str(page.errors[:2]))
        browser.close()
finally:
    relay.terminate()
    site.stop()
    plain_site.stop()

print("\nFAILED: " + ", ".join(failures) if failures else "\nall checks passed")
sys.exit(1 if failures else 0)

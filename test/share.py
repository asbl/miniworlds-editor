"""Project links: UI round trip, binary assets, unsaved edits, fresh copies and no automatic execution.

Needs npm run build and a preview server on port 4173. No Python runtime downloads required.
"""
import base64, gzip, json, os, random, sys, zipfile
from playwright.sync_api import sync_playwright, expect
sys.path.insert(0, os.path.dirname(__file__))
from support import check, failures, FILES_FIRST

URL = "http://localhost:4173/"
BROWSER = sys.argv[1] if len(sys.argv) > 1 else "chromium"
CODE = 'print("Grüße aus dem Link 🦀")\n'
BINARY = bytes(range(256))


def encoded(data):
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


snapshot = {"name": "Linkaufgabe", "files": [
    {"path": "main.py", "data": encoded(CODE.encode())},
    {"path": "images/test.png", "data": encoded(BINARY)},
    {"path": "sounds/test.ogg", "data": encoded(BINARY[::-1])},
]}
LINK = URL + "#project=v1." + encoded(gzip.compress(json.dumps(snapshot).encode()))


def project_menu(page, item):
    page.get_by_role("button", name="Projekt:").click()
    page.get_by_role("menuitem", name=item, exact=True).click()


def project_names(page):
    return page.evaluate("""async () => {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle('projects');
        const names = []; for await (const [name] of dir.entries()) names.push(name);
        return names.sort();
    }""")


with sync_playwright() as p:
    browser = getattr(p, BROWSER).launch()
    context = browser.new_context(locale="de-DE", accept_downloads=True)
    context.add_init_script(FILES_FIRST)
    context.add_init_script("""
      window.__runs = 0;
      const original = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function(message, ...args) {
        if (message?.type === 'run') window.__runs++;
        return original.call(this, message, ...args);
      };
    """)
    if BROWSER == "chromium":
        context.grant_permissions(["clipboard-read", "clipboard-write"])
    page = context.new_page()
    errors, requests = [], []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("request", lambda request: requests.append(request.url))
    page.goto(LINK)
    expect(page.get_by_role("button", name="Projekt: Linkaufgabe ▾", exact=True)).to_be_visible()
    expect(page.locator(".cm-content")).to_contain_text("Grüße aus dem Link")
    check("fragment is cleared", "#" not in page.url, page.url)
    check("first import makes only the shared project", project_names(page) == ["Linkaufgabe"])
    check("snapshot stays out of network requests", all("#project=" not in url for url in requests))
    check("does not execute imported code", page.evaluate("window.__runs") == 0)

    # Sharing flushes pending edits and leaves the sender's address unchanged.
    page.click(".cm-content")
    page.keyboard.press("Control+End")
    page.keyboard.insert_text("# sofort geteilt")
    project_menu(page, "Als Link teilen …")
    dialog = page.locator("dialog[open]")
    link = dialog.get_by_label("Projektlink").input_value()
    check("creates a versioned fragment link", link.startswith(URL + "#project=v1."), link[:90])
    check("sharing leaves the address clean", page.url == URL)
    dialog.get_by_role("button", name="QR-Code anzeigen", exact=True).click()
    qr_image = dialog.get_by_role("img", name="QR-Code zum Öffnen des geteilten Projekts")
    expect(qr_image).to_be_visible()
    page.add_script_tag(path=os.path.join(os.path.dirname(__file__), "../node_modules/jsqr/dist/jsQR.js"))
    decoded = qr_image.evaluate("""img => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
        return window.jsQR(pixels.data, pixels.width, pixels.height)?.data;
    }""")
    check("rendered QR decodes to the complete project link", decoded == link)
    with page.expect_download() as qr_download:
        dialog.get_by_role("link", name="QR-Code als PNG speichern").click()
    with open(qr_download.value.path(), "rb") as png:
        check("QR can be saved as PNG", png.read(8) == b"\x89PNG\r\n\x1a\n")
    dialog.get_by_role("button", name="QR-Code ausblenden", exact=True).click()
    expect(qr_image).to_have_count(0)
    dialog.get_by_role("button", name="Link kopieren", exact=True).click()
    if BROWSER == "chromium":
        expect(dialog.get_by_role("status")).to_have_text("Link kopiert.")
        check("clipboard contains the complete link", page.evaluate("navigator.clipboard.readText()") == link)
    dialog.get_by_role("button", name="OK", exact=True).click()

    # Same context: no overwrite. ZIP verifies bytes, not only filenames in the tree.
    page.goto(link)
    expect(page.get_by_role("button", name="Projekt: Linkaufgabe 2 ▾", exact=True)).to_be_visible()
    expect(page.locator(".cm-content")).to_contain_text("# sofort geteilt")
    with page.expect_download() as download:
        project_menu(page, "Als ZIP exportieren")
    with zipfile.ZipFile(download.value.path()) as archive:
        check("shares current editor contents", archive.read("main.py").decode() == CODE + "# sofort geteilt")
        check("preserves embedded image bytes", archive.read("images/test.png") == BINARY)
        check("preserves embedded sound bytes", archive.read("sounds/test.ogg") == BINARY[::-1])
    page.reload()
    expect(page.locator(".cm-content")).to_be_visible()
    check("reload does not create another copy", project_names(page) == ["Linkaufgabe", "Linkaufgabe 2"])
    check("copy also stays unexecuted", page.evaluate("window.__runs") == 0)

    # Fresh browser storage: receives every file, with no dependency on the sender's storage.
    other = browser.new_context(locale="de-DE")
    other.add_init_script(FILES_FIRST)
    receiver = other.new_page()
    receiver.goto(link)
    expect(receiver.get_by_role("button", name="Projekt: Linkaufgabe ▾", exact=True)).to_be_visible()
    expect(receiver.locator(".cm-content")).to_contain_text("# sofort geteilt")
    other.close()

    page.goto(URL + "#project=v9.unknown")
    expect(page.locator("dialog[open]")).to_contain_text("unbekanntes Format")
    check("bad links preserve existing projects", project_names(page) == ["Linkaufgabe", "Linkaufgabe 2"])
    page.locator("dialog[open]").get_by_role("button", name="OK", exact=True).click()

    # A valid share link may still exceed the QR's capacity: keep link sharing available.
    # Incompressible data ensures this is over QR capacity while still well below the link limit.
    large = {"name": "Großes Projekt", "files": [
        {"path": "main.py", "data": encoded(CODE.encode())},
        {"path": "data.bin", "data": encoded(random.Random(42).randbytes(4000))},
    ]}
    page.goto(URL + "#project=v1." + encoded(gzip.compress(json.dumps(large).encode())))
    expect(page.get_by_role("button", name="Projekt: Großes Projekt ▾", exact=True)).to_be_visible()
    project_menu(page, "Als Link teilen …")
    dialog = page.locator("dialog[open]")
    dialog.get_by_role("button", name="QR-Code anzeigen", exact=True).click()
    expect(dialog.get_by_role("alert")).to_contain_text("Für diesen Link kann kein QR-Code erstellt werden")
    expect(dialog.get_by_role("img")).to_have_count(0)
    check("large link remains available to copy", len(dialog.get_by_label("Projektlink").input_value()) > 4000)
    expect(dialog.get_by_role("button", name="Link kopieren", exact=True)).to_be_enabled()
    check("no page errors", not errors, str(errors[:3]))
    browser.close()

print("\nall passed" if not failures else f"\n{len(failures)} failed: {failures}")
sys.exit(1 if failures else 0)

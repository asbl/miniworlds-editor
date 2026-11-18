"""Browser test: links that open a task (?template=, ?zip=).

Needs `npm run build && npx vite preview --port 4173` and Python with Playwright. Usage:  python test/launch.py [chromium|firefox]
"""
import io, os, sys, zipfile
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
from support import check, eventually, failures

URL = "http://localhost:4173/"
BROWSER = sys.argv[1] if len(sys.argv) > 1 else "chromium"

buffer = io.BytesIO()
with zipfile.ZipFile(buffer, "w") as z:
    z.writestr("main.py", 'print("aus dem Link")\n')
    z.writestr("project.toml", '[project]\nname = "Aufgabe"\nentry = "main.py"\n')
ZIP = buffer.getvalue()


def projects(page):
    page.get_by_role("button", name="Projekt:").click()
    items = [i.strip(" ✓\n") for i in page.locator(".menu-items button").all_inner_texts()]
    page.keyboard.press("Escape")
    return items


with sync_playwright() as p:
    browser = getattr(p, BROWSER).launch()
    ctx = browser.new_context(locale="de-DE")
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.route("https://aufgaben.example/a1.zip", lambda route: route.fulfill(status=200, body=ZIP, headers={"access-control-allow-origin": "*", "content-type": "application/zip"}))
    page.route("https://aufgaben.example/kaputt.zip", lambda route: route.fulfill(status=404, body="no", headers={"access-control-allow-origin": "*"}))

    # ---- template link
    page.goto(URL + "?template=krabbe&name=Aufgabe%201")
    page.wait_for_selector(".cm-content")
    check("the template opens as a new project", eventually(lambda: "Projekt: Aufgabe 1" in page.inner_text(".topbar"), 20000), page.inner_text(".topbar"))
    check("the link is removed from the address bar", "template" not in page.url, page.url)
    check("the template's tasks come along", eventually(lambda: "Aufgaben" in page.inner_text(".world-panel") or page.locator(".tasks").count() == 1, 10000))
    n = len(projects(page))
    page.goto(URL + "?template=krabbe&name=Aufgabe%201")
    page.wait_for_selector(".cm-content")
    check("the same link opens the project again, no copy", eventually(lambda: "Projekt: Aufgabe 1" in page.inner_text(".topbar"), 20000) and len(projects(page)) == n, str(projects(page)))
    page.goto(URL + "?template=gibtesnicht")
    check("an unknown template is reported", eventually(lambda: "gibt es nicht" in page.inner_text("dialog[open]"), 20000))
    page.locator("dialog[open]").get_by_role("button", name="OK").click()

    # ---- a language in the link applies to this visit only
    page.goto(URL + "?template=sammler&lang=en&name=Task%20EN")
    page.wait_for_selector(".cm-content")
    check("the link's language is used", eventually(lambda: "Project: Task EN" in page.inner_text(".topbar"), 20000), page.inner_text(".topbar"))
    page.goto(URL)
    page.wait_for_selector(".cm-content")
    check("but not remembered", eventually(lambda: "Projekt:" in page.inner_text(".topbar"), 10000), page.inner_text(".topbar"))

    # ---- ZIP link: asks first
    page.goto(URL + "?zip=https://aufgaben.example/a1.zip&name=Hausaufgabe")
    check("the link asks before it loads from another site", eventually(lambda: "aufgaben.example" in page.inner_text("dialog[open]"), 20000))
    page.locator("dialog[open]").get_by_role("button", name="Abbrechen").click()
    page.wait_for_selector("dialog[open]", state="detached")
    check("declining makes no project", "Hausaufgabe" not in " ".join(projects(page)))
    page.goto(URL + "?zip=https://aufgaben.example/a1.zip&name=Hausaufgabe")
    page.wait_for_selector("dialog[open]")
    page.locator("dialog[open]").get_by_role("button", name="OK").click()
    page.wait_for_selector("dialog[open]")  # "2 Dateien importiert"
    page.locator("dialog[open]").get_by_role("button", name="OK").click()
    check("the ZIP becomes a project", eventually(lambda: "Projekt: Hausaufgabe" in page.inner_text(".topbar"), 20000), page.inner_text(".topbar"))
    page.get_by_role("tab", name="Dateien").click()
    page.locator(".tree .row-main", has_text="main.py").click()
    check("with its files", eventually(lambda: "aus dem Link" in page.inner_text(".cm-content"), 10000))
    page.goto(URL + "?zip=https://aufgaben.example/kaputt.zip")
    page.wait_for_selector("dialog[open]")
    page.locator("dialog[open]").get_by_role("button", name="OK").click()
    check("a failing download is explained", eventually(lambda: "konnte nicht geladen werden" in page.inner_text("dialog[open]"), 10000))
    page.locator("dialog[open]").get_by_role("button", name="OK").click()
    page.goto(URL + "?zip=javascript:alert(1)")
    page.wait_for_selector(".cm-content")
    check("other kinds of addresses are ignored", page.locator("dialog[open]").count() == 0)
    check("no page errors", not errors, str(errors[:3]))
    browser.close()

print("\nall passed" if not failures else f"\n{len(failures)} failed: {failures}")
sys.exit(1 if failures else 0)

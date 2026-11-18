"""Browser test of the history (snapshots): automatic snapshots, diff view, restore (file and everything, undoable),
named versions, persistence, rename/delete of the project, narrow screens.

Needs `npm run build && npx vite preview --port 4173` and Python with Playwright. Usage:  python test/history.py [chromium|firefox]
"""
import os, sys
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
from support import ROOT, check, eventually, failures

URL = "http://localhost:4173/"
BROWSER = sys.argv[1] if len(sys.argv) > 1 else "chromium"
AXE = os.path.join(ROOT, "node_modules", "axe-core", "axe.min.js")


def history_tab(page):
    page.locator(".sidebar-tabs [role=tab]", has_text="Verlauf").click()


def rows(page):
    return page.locator(".history-row").all_inner_texts()


def editor_text(page):
    return page.inner_text(".cm-content")


def type_into_main(page, text):
    page.locator(".tab-name", has_text="main.py").click()
    page.click(".cm-content")
    page.keyboard.press("Control+End")
    page.keyboard.insert_text(text)


def ok(page, name="OK"):
    page.locator("dialog[open]").last.get_by_role("button", name=name).click()


with sync_playwright() as p:
    browser = getattr(p, BROWSER).launch()
    ctx = browser.new_context(locale="de-DE", viewport={"width": 1366, "height": 800})
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL)
    page.wait_for_selector(".cm-content")

    # ---- the start of a session is remembered
    history_tab(page)
    check("a snapshot 'when opened' exists", eventually(lambda: any("Beim Öffnen" in r for r in rows(page)), 10000), str(rows(page)))
    check("rows show time and file count", any("Dateien" in r for r in rows(page)))

    # ---- before a run
    page.locator(".sidebar-tabs [role=tab]", has_text="Dateien").click()
    type_into_main(page, "\n# erste Aenderung")
    page.wait_for_timeout(700)
    page.keyboard.press("Control+Enter")
    history_tab(page)
    check("a snapshot 'before run' appears", eventually(lambda: any("Vor dem Start" in r for r in rows(page)), 15000), str(rows(page)))
    page.keyboard.press("Control+Enter")  # stop again
    page.wait_for_timeout(800)

    # ---- diff and restore of one file
    page.locator(".tab-name", has_text="main.py").click()
    page.click(".cm-content")
    page.keyboard.press("Control+End")
    page.keyboard.insert_text("\n# zweite Aenderung")
    page.wait_for_timeout(700)
    history_tab(page)
    page.locator(".history-row", has_text="Vor dem Start").first.click()
    dialog = page.locator(".history-dialog")
    check("dialog opens with the snapshot", eventually(lambda: dialog.is_visible(), 5000))
    check("main.py is listed as changed", "geändert" in dialog.inner_text(), dialog.inner_text()[:200])
    check("diff shows the line that would disappear", "zweite Aenderung" in dialog.locator(".dl.del").all_inner_texts().__str__(), str(dialog.locator(".dl.del").all_inner_texts()))
    dialog.get_by_role("button", name="Diese Datei zurückholen").click()
    ok(page)  # info: restored
    page.locator(".history-dialog").get_by_role("button", name="Schließen").click()
    page.locator(".tab-name", has_text="main.py").click()
    check("restore put the older text back", eventually(lambda: "erste Aenderung" in editor_text(page) and "zweite Aenderung" not in editor_text(page), 5000), editor_text(page)[-80:])
    history_tab(page)
    check("the state before restoring is kept", eventually(lambda: any("Vor dem Zurücksetzen" in r for r in rows(page)), 5000), str(rows(page)))

    # ---- undo the restore: the second change comes back
    page.locator(".history-row", has_text="Vor dem Zurücksetzen").first.click()
    page.locator(".history-dialog").get_by_role("button", name="Alles auf diesen Stand setzen").click()
    ok(page)  # confirm
    ok(page)  # info
    check("restoring 'before restoring' brings the work back", eventually(lambda: "zweite Aenderung" in editor_text(page), 5000), editor_text(page)[-80:])

    # ---- restore everything: removes files that did not exist then
    page.locator(".sidebar-tabs [role=tab]", has_text="Dateien").click()
    page.locator(".sidebar-tabs .menu-button", has_text="+").click()
    page.get_by_role("menuitem", name="Neue Klasse").click()
    d = page.locator("dialog[open]")
    d.get_by_label("Klassenname").fill("Neu")
    d.get_by_role("button", name="Anlegen").click()
    page.wait_for_selector("dialog[open]", state="detached")
    check("new class file exists", eventually(lambda: page.locator(".tree", has_text="Neu.py").count() > 0, 5000))
    history_tab(page)
    page.locator(".history-row", has_text="Beim Öffnen").first.click()
    dlg = page.locator(".history-dialog")
    check("new file is marked as newer", eventually(lambda: "neuer" in dlg.inner_text(), 5000))
    dlg.get_by_role("button", name="Alles auf diesen Stand setzen").click()
    ok(page)
    ok(page)
    page.locator(".sidebar-tabs [role=tab]", has_text="Dateien").click()
    check("restore everything removed the newer file", eventually(lambda: page.locator(".tree", has_text="Neu.py").count() == 0, 5000))
    page.locator(".tab-name", has_text="main.py").click()
    check("and main.py is as at the start", eventually(lambda: "erste Aenderung" not in editor_text(page) and "from classes.Spielfeld" in editor_text(page), 5000), editor_text(page)[-120:])
    check("restoring also rewrote main.py's import of the removed class", "Neu" not in editor_text(page), editor_text(page)[-120:])

    # ---- a named version stays and survives a reload
    history_tab(page)
    page.get_by_role("button", name="Stand merken").click()
    d = page.locator("dialog[open]")
    d.get_by_label("Name für diesen Stand").fill("Krabbe läuft")
    d.get_by_role("button", name="OK").click()
    check("named version listed", eventually(lambda: any("Krabbe läuft" in r for r in rows(page)), 5000), str(rows(page)))
    page.reload()
    page.wait_for_selector(".cm-content")
    history_tab(page)
    check("history survives a reload (stored in the browser)", eventually(lambda: any("Krabbe läuft" in r for r in rows(page)), 10000), str(rows(page)))

    # ---- deleting a file remembers the state before (when something is new since the last snapshot)
    type_into_main(page, "\n# vor dem Loeschen")
    page.wait_for_timeout(700)
    page.locator(".sidebar-tabs [role=tab]", has_text="Dateien").click()
    page.locator(".tree .row", has_text="Spielfeld.py").hover()
    page.get_by_label("Löschen classes/Spielfeld.py").click()
    ok(page, "Löschen")
    history_tab(page)
    check("'before delete' snapshot", eventually(lambda: any("Vor dem Löschen" in r for r in rows(page)), 5000), str(rows(page)))
    page.locator(".history-row", has_text="Vor dem Löschen").first.click()
    dlg = page.locator(".history-dialog")
    check("deleted file is offered as missing", eventually(lambda: "fehlt jetzt" in dlg.inner_text(), 5000))
    dlg.locator(".history-file", has_text="Spielfeld.py").click()
    dlg.get_by_role("button", name="Diese Datei zurückholen").click()
    ok(page)
    dlg.get_by_role("button", name="Schließen").click()
    page.locator(".sidebar-tabs [role=tab]", has_text="Dateien").click()
    check("deleted class file is back", eventually(lambda: page.locator(".tree", has_text="Spielfeld.py").count() > 0, 5000))

    # ---- accessibility of the tab and the dialog
    page.add_script_tag(path=AXE)
    history_tab(page)
    found = page.evaluate("axe.run(document, { resultTypes: ['violations'] }).then(r => r.violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).slice(0, 2).join(' | ')))")
    check("no axe violations in the history tab", found == [], str(found))
    page.locator(".history-row").first.click()
    page.wait_for_selector(".history-dialog")
    found = page.evaluate("axe.run(document, { resultTypes: ['violations'] }).then(r => r.violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).slice(0, 2).join(' | ')))")
    check("no axe violations in the history dialog", found == [], str(found))
    page.locator(".history-dialog").get_by_role("button", name="Schließen").click()

    # ---- renaming the project keeps its history
    page.locator(".topbar .menu-button", has_text="Projekt").click()
    page.get_by_role("menuitem", name="Umbenennen").click()
    d = page.locator("dialog[open]")
    d.get_by_label("Projektname").fill("Umbenannt")
    d.get_by_role("button", name="OK").click()
    page.wait_for_selector("dialog[open]", state="detached")
    history_tab(page)
    check("history moved with the renamed project", eventually(lambda: any("Krabbe läuft" in r for r in rows(page)), 10000), str(rows(page)))
    LIST = "navigator.storage.getDirectory().then(async r => { const out = []; try { const h = await r.getDirectoryHandle('history'); for await (const [n] of h.entries()) out.push(n) } catch {} return out })"
    check("only the new name has a history folder", eventually(lambda: page.evaluate(LIST) == ["Umbenannt"], 10000), str(page.evaluate(LIST)))
    page.close()

    # ---- narrow screen
    page = browser.new_context(locale="de-DE", viewport={"width": 390, "height": 800}).new_page()
    page.goto(URL)
    page.wait_for_selector(".pane-tabs")
    page.locator(".pane-tabs [role=tab]:nth-child(1)").click()
    history_tab(page)
    page.locator(".history-row").first.click()
    dlg = page.locator(".history-dialog")
    check("narrow: dialog fits the screen", eventually(lambda: dlg.is_visible() and dlg.bounding_box()["width"] <= 390 and page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), 5000))
    check("narrow: restore buttons reachable", dlg.get_by_role("button", name="Schließen").is_visible())
    check("no page errors", errors == [], str(errors))
    browser.close()

print("\nall passed" if not failures else f"\nFAILED: {failures}")
sys.exit(1 if failures else 0)

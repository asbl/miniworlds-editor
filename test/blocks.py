"""Block dropdown regression: clickable while Python loads, including crowded tabs.

Needs a build and the preview server on port 4173. No Python runtime downloads.
Usage: python test/blocks.py [chromium|firefox]
"""
import sys
from playwright.sync_api import sync_playwright, expect
from support import FILES_FIRST, set_main


with sync_playwright() as p:
    browser = getattr(p, sys.argv[1] if len(sys.argv) > 1 else "chromium").launch()
    page = browser.new_page(locale="de-DE", viewport={"width": 1400, "height": 860})
    page.add_init_script(FILES_FIRST)
    # Keep both Python workers loading: blocks must work independently of them.
    page.route("**/*pyodide*", lambda route: route.abort())
    page.goto("http://localhost:4173/")
    page.wait_for_selector(".cm-content")
    set_main(page, "class A:\n    def act(self):\n        pass\n")

    for width in (1400, 1000, 390):
        page.set_viewport_size({"width": width, "height": 860})
        page.locator(".cm-content").click()
        page.keyboard.press("Control+End")
        button = page.locator(".tabs .menu-button", has_text="Baustein")
        button.click()
        expect(button).to_have_attribute("aria-expanded", "true")
        item = page.get_by_role("menuitem", name="Vorwärts bewegen", exact=True)
        # Visibility alone misses overflow clipping; Playwright's click may even
        # scroll the hidden menu into view. Check hit testing before it scrolls.
        assert item.evaluate("""el => {
            const r = el.getBoundingClientRect();
            return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
        }"""), "the block menu is clipped or covered"
        item.click(timeout=5000)
        page.keyboard.type("9")
        expect(page.locator(".cm-content")).to_contain_text("self.move(9)")
        expect(button).to_have_attribute("aria-expanded", "false")
        button.click()
        page.wait_for_timeout(150)  # allow the menu's outside-click/Escape effect to attach
        page.keyboard.press("Escape")
        expect(page.get_by_role("menu")).to_have_count(0)
        print(f"ok   block insertion and Escape at {width}px", flush=True)

    page.set_viewport_size({"width": 1400, "height": 860})
    main = "from miniworlds import World, Actor\nwelt = World(400, 500)\nschiff = Actor((200, 440))\nwelt.run()\n"
    set_main(page, main)
    page.keyboard.press("Control+Home")
    for name in ("Nach rechts drehen", "Zähler um 1 erhöhen"):
        button.click()
        page.get_by_role("menuitem", name=name, exact=True).click()
        dialog = page.locator("dialog[open]")
        expect(dialog).to_contain_text("Dieser Baustein verwendet self")
        dialog.get_by_role("button", name="OK", exact=True).click()
        assert "self." not in page.locator(".cm-content").inner_text()
    print("ok   self statements are refused at module level without changing code", flush=True)

    button.click()
    page.get_by_role("menuitem", name="In jedem Schritt (act)", exact=True).click()
    dialog = page.locator("dialog[open]")
    expect(dialog.get_by_label("Objekt")).to_have_value("welt")
    assert dialog.locator("option").all_text_contents() == ["welt (World)", "schiff (Actor)"]
    dialog.get_by_label("Objekt").select_option("schiff")
    dialog.get_by_role("button", name="Abbrechen", exact=True).click()
    assert "@schiff.register" not in page.locator(".cm-content").inner_text()
    button.click()
    page.get_by_role("menuitem", name="In jedem Schritt (act)", exact=True).click()
    dialog = page.locator("dialog[open]")
    dialog.get_by_label("Objekt").select_option("schiff")
    dialog.get_by_role("button", name="OK", exact=True).click()
    expect(page.locator(".cm-content")).to_be_focused()
    page.keyboard.type("self.move(9)")
    text = "\n".join(page.locator(".cm-line").all_text_contents())
    assert "@schiff.register\ndef act(self):\n    self.move(9)\n\nwelt.run()" in text, text
    print("ok   handler attaches to the chosen instance before run; cancel leaves code unchanged", flush=True)

    # self remains usable inside the registered handler.
    button.click()
    page.get_by_role("menuitem", name="Nach rechts drehen", exact=True).click()
    page.keyboard.type("45")
    expect(page.locator(".cm-content")).to_contain_text("self.turn_right(45)")

    set_main(page, "x = 1\n")
    button.click()
    page.get_by_role("menuitem", name="In jedem Schritt (act)", exact=True).click()
    dialog = page.locator("dialog[open]")
    expect(dialog).to_contain_text("erzeuge zuerst ein benanntes Objekt")
    dialog.get_by_role("button", name="OK", exact=True).click()

    set_main(page, "class A:\n    def act(self):\n        pass\n")
    page.keyboard.press("Control+End")
    button.click()
    page.get_by_role("menuitem", name="Beim Erzeugen vorbereiten (on_setup)", exact=True).click()
    expect(page.locator("dialog[open]")).to_have_count(0)
    expect(page.locator(".cm-content")).to_contain_text("    def on_setup(self):")
    print("ok   missing instances get an explanation; class methods still insert directly", flush=True)

    # Many long file names scroll without pushing the block button out of reach.
    page.set_viewport_size({"width": 390, "height": 860})
    page.evaluate("""() => {
        const list = document.querySelector('.tabs .tab-list');
        for (let i = 0; i < 12; i++) {
            const tab = list.firstElementChild.cloneNode(true);
            tab.querySelector('button').textContent = `long_class_filename_${i}.py`;
            list.append(tab);
        }
    }""")
    assert page.locator(".tabs .tab-list").evaluate("el => el.scrollWidth > el.clientWidth")
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
    button.click()
    page.get_by_role("menuitem", name="Vorwärts bewegen", exact=True).click(timeout=5000)
    page.keyboard.type("7")
    expect(page.locator(".cm-content")).to_contain_text("self.move(7)")
    print("ok   crowded file tabs scroll and leave the dropdown clickable", flush=True)

    # Read help by keyboard without inserting, then return focus to the menu.
    before = page.locator(".cm-content").inner_text()
    button.focus()
    page.keyboard.press("Enter")
    page.keyboard.press("Tab")
    expect(page.get_by_role("menuitem", name="Vorwärts bewegen", exact=True)).to_be_focused()
    page.keyboard.press("Tab")
    help_item = page.get_by_role("menuitem", name="Erklärung zu „Vorwärts bewegen“", exact=True)
    expect(help_item).to_be_focused()
    page.keyboard.press("Enter")
    help_dialog = page.get_by_role("dialog", name="Vorwärts bewegen", exact=True)
    expect(help_dialog).to_contain_text("Blickrichtung")
    expect(help_dialog.locator("pre")).to_have_text("self.move(3)")
    page.keyboard.press("Escape")
    expect(page.locator("dialog[open]")).to_have_count(0)
    expect(button).to_be_focused()
    assert page.locator(".cm-content").inner_text() == before
    print("ok   keyboard help reads the explanation and preview without inserting code", flush=True)

    # A real touch context cannot rely on hover or native title tooltips.
    touch = browser.new_context(has_touch=True, locale="de-DE", viewport={"width": 320, "height": 860})
    touch.add_init_script(FILES_FIRST)
    phone = touch.new_page()
    phone.route("**/*pyodide*", lambda route: route.abort())
    phone.goto("http://localhost:4173/")
    phone.wait_for_selector(".cm-content")
    before = phone.locator(".cm-content").inner_text()
    phone.locator(".tabs .menu-button", has_text="Bausteine").tap()
    phone.get_by_role("menuitem", name="Erklärung zu „Vorwärts bewegen“", exact=True).tap()
    help_dialog = phone.get_by_role("dialog", name="Vorwärts bewegen", exact=True)
    expect(help_dialog).to_contain_text("Blickrichtung")
    expect(help_dialog.locator("pre")).to_have_text("self.move(3)")
    help_dialog.get_by_role("button", name="Schließen", exact=True).tap()
    assert phone.locator(".cm-content").inner_text() == before
    assert phone.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
    touch.close()
    print("ok   touch help works at 320px without changing the code", flush=True)
    browser.close()

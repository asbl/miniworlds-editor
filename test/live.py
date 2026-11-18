"""Smoke test of a deployed editor: start, run a program, Pyodide from the site's own origin, Service Worker, embed headers.

Needs network. Usage:  python test/live.py https://editor.example.org/ [chromium|firefox]
"""
import os, sys
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
from support import FILES_FIRST, check, console, eventually, failures, set_main, wait_ready

URL = sys.argv[1].rstrip("/") + "/"
BROWSER = sys.argv[2] if len(sys.argv) > 2 else "chromium"

with sync_playwright() as p:
    browser = getattr(p, BROWSER).launch()
    page = browser.new_page()
    cdn, own, errors, bad = [], [], [], []
    page.on("request", lambda r: cdn.append(r.url) if "cdn.jsdelivr.net" in r.url else own.append(r.url) if "/pyodide/" in r.url else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("response", lambda r: bad.append(f"{r.status} {r.url}") if r.status >= 400 and r.url.startswith(URL) else None)
    page.add_init_script(FILES_FIRST)
    response = page.goto(URL)
    check("page loads", response and response.ok)
    csp = response.headers.get("content-security-policy", "")
    check("only listed pages may frame the editor", "frame-ancestors" in csp, csp)
    page.wait_for_selector(".tree", timeout=30000)
    config = page.evaluate("fetch('config.json').then(r => r.json())")
    check("config.json points at the own Pyodide", config.get("pyodideBase", "").startswith("./pyodide/"), str(config))
    check("embedding is restricted to listed origins", config.get("embedOrigins") not in (None, [], ["*"]), str(config.get("embedOrigins")))
    check("manifest is served", page.evaluate("fetch(document.querySelector('link[rel=manifest]').href).then(r => r.ok)"))
    check("service worker active", eventually(lambda: page.evaluate("navigator.serviceWorker.ready.then(r => !!r.active)"), 30000))
    set_main(page, "import numpy\nprint('live', numpy.arange(4).sum())")
    check("world ready", wait_ready(page), str(page.locator("dialog[open]").all_inner_texts()))
    page.click(".toolbar .run")
    check("program runs", eventually(lambda: "live 6" in console(page), 120000))
    page.wait_for_timeout(6000)  # the language worker boots as well
    check("Pyodide came from the own origin", any("pyodide.asm.wasm" in u for u in own), str(own[:3]))
    check("nothing from the CDN", cdn == [], str(cdn[:3]))
    check("no failed requests to the site", bad == [], str(bad[:5]))
    # input() and the policy together: the program waits for a line in the console
    set_main(page, 'name = input("Name? ")\nprint("hallo", name)')
    page.click(".toolbar .run")
    check("input() asks", eventually(lambda: page.locator(".console-input input").count() == 1, 60000))
    eventually(lambda: page.evaluate("document.activeElement?.closest('.console-input') !== null"), 5000)
    page.keyboard.type("Ada")
    page.keyboard.press("Enter")
    check("input() continues", eventually(lambda: "hallo Ada" in console(page), 30000), console(page)[-200:])
    check("no page errors", errors == [], str(errors))
    browser.close()

print("\nall passed" if not failures else f"\nFAILED: {failures}")
sys.exit(1 if failures else 0)

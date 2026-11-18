"""Browser test: the editor works under the Content Security Policy of deploy/nginx.conf (self-hosted Pyodide).

Needs network (the Pyodide download once, PyPI for miniworlds), `npm run build` first and Python with Playwright.
Usage:  python test/csp.py [chromium|firefox]
"""
import os, re, shutil, subprocess, sys
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
from support import FILES_FIRST, ROOT, Server, check, console, copy_dist, eventually, failures, set_main, wait_ready

BROWSER = sys.argv[1] if len(sys.argv) > 1 else "chromium"
PORT = 4183
conf = open(os.path.join(ROOT, "deploy", "nginx.conf"), encoding="utf-8").read()
CSP = re.search(r'set \$csp "([^"]+)";', conf).group(1)
check("the policy is read from nginx.conf", "script-src 'self' 'unsafe-eval'" in CSP and "script-src 'self' 'unsafe-eval' http" not in CSP, CSP)

dist = copy_dist()
subprocess.run(["node", "scripts/selfhost.mjs", dist], cwd=ROOT, check=True)

# the policy is sent as a real header (a route cannot hold workers to it)
os.environ["MW_CSP"] = CSP
server = Server(dist, PORT).start()

with sync_playwright() as p:
    browser = getattr(p, BROWSER).launch()
    page = browser.new_page(locale="de-DE")
    violations, errors = [], []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: violations.append(m.text) if "Content Security Policy" in m.text or "Content-Security-Policy" in m.text else None)
    page.add_init_script(FILES_FIRST)
    page.goto(f"http://localhost:{PORT}/")
    page.wait_for_selector(".tree", timeout=30000)
    page.evaluate("(() => { const s = document.createElement('script'); s.textContent = 'window.__inline = 1'; document.head.append(s) })()")
    check("the policy is enforced (an inline script does not run)", page.evaluate("window.__inline === undefined"))
    violations.clear()  # that was provoked on purpose
    check("world ready under the policy", wait_ready(page))
    set_main(page, 'import numpy\nname = input("Name? ")\nprint("csp", numpy.arange(4).sum(), name)\n')
    page.click(".toolbar .run")
    check("input() asks", eventually(lambda: page.locator(".console-input input").count() == 1, 60000), console(page)[-300:])
    check("the field has the focus", eventually(lambda: page.evaluate("document.activeElement?.closest('.console-input') !== null"), 5000))
    page.keyboard.type("Ada")
    page.keyboard.press("Enter")
    check("a program with numpy and input() runs", eventually(lambda: "csp 6 Ada" in console(page), 60000), console(page)[-300:])
    # editor help: jedi (Python) and ruff (WebAssembly) in the language worker
    page.click(".cm-content")
    page.keyboard.press("Control+End")
    page.keyboard.insert_text("\nimport miniworlds as mw\nmw.Circ")
    check("completion works (jedi)", eventually(lambda: "Circle" in (page.locator(".cm-tooltip-autocomplete").inner_text() if page.locator(".cm-tooltip-autocomplete").count() else ""), 90000))
    page.keyboard.press("Escape")
    check("the service worker is active", eventually(lambda: page.evaluate("navigator.serviceWorker.controller !== null || navigator.serviceWorker.ready.then(() => true)"), 20000))
    check("no page errors", errors == [], str(errors[:3]))
    check("the browser reported no policy violations", violations == [], str(violations[:3]))
    browser.close()

server.stop()
shutil.rmtree(dist, ignore_errors=True)
print("\nall passed" if not failures else f"\nFAILED: {failures}")
sys.exit(1 if failures else 0)

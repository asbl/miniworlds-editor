"""Browser test of self-hosted Pyodide (milestone 5): after scripts/selfhost.mjs nothing is loaded from the CDN.

Needs network (the download once, PyPI for miniworlds), `npm run build` first and Python with Playwright.
Usage:  python test/selfhost.py [chromium|firefox]
"""
import os, shutil, subprocess, sys
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
from support import FILES_FIRST, ROOT, Server, check, console, copy_dist, eventually, failures, set_main, wait_ready

BROWSER = sys.argv[1] if len(sys.argv) > 1 else "chromium"
dist = copy_dist()
subprocess.run(["node", "scripts/selfhost.mjs", dist], cwd=ROOT, check=True)
server = Server(dist, 4182).start()

with sync_playwright() as p:
    browser = getattr(p, BROWSER).launch()
    page = browser.new_page()
    cdn, local, errors = [], [], []
    page.on("request", lambda r: cdn.append(r.url) if "cdn.jsdelivr.net" in r.url else local.append(r.url) if "/pyodide/" in r.url else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(FILES_FIRST)
    page.goto("http://localhost:4182/")
    page.wait_for_selector(".tree", timeout=30000)
    set_main(page, 'import numpy\nprint("lokal", numpy.arange(3).sum())')
    check("world ready", wait_ready(page))
    page.click(".toolbar .run")
    check("program runs (numpy comes from the own server)", eventually(lambda: "lokal 3" in console(page), 90000))
    page.wait_for_timeout(5000)  # language worker (jedi) boots as well
    check("Pyodide files came from the own origin", any("pyodide.asm.wasm" in u for u in local) and any("numpy" in u for u in local), str(local[:5]))
    check("nothing was loaded from the CDN", cdn == [], str(cdn[:5]))
    check("no page errors", errors == [], str(errors))
    browser.close()

server.stop()
shutil.rmtree(dist, ignore_errors=True)
print("\nall passed" if not failures else f"\nFAILED: {failures}")
sys.exit(1 if failures else 0)

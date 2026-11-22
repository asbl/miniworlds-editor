"""Browser test of the PWA (milestone 5): manifest, Service Worker, start without network, update flow.

Needs network once (Pyodide, miniworlds), `npm run build` first and Python with Playwright.
Usage:  python test/pwa.py [chromium|firefox]
"""
import json, os, re, shutil, sys
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
from support import FILES_FIRST, Server, check, console, copy_dist, eventually, failures, set_main, wait_ready

BROWSER = sys.argv[1] if len(sys.argv) > 1 else "chromium"
PORT = 4180
dist = copy_dist()
server = Server(dist, PORT).start()
URL = f"http://localhost:{PORT}/"

with sync_playwright() as p:
    browser = getattr(p, BROWSER).launch()
    context = browser.new_context(locale="de-DE")
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(FILES_FIRST)
    page.goto(URL)
    page.wait_for_selector(".tree", timeout=30000)

    manifest = json.loads(page.evaluate("fetch(document.querySelector('link[rel=manifest]').href).then(r => r.text())"))
    check("manifest with name, start_url and icons", manifest["name"] and manifest["start_url"] == "./" and any(i["sizes"] == "512x512" for i in manifest["icons"]))
    check("service worker active", eventually(lambda: page.evaluate("navigator.serviceWorker.ready.then(r => !!r.active)"), 30000))
    def cache_names():
        try:
            return page.evaluate("caches.keys()")
        except Exception:  # the page is reloading
            return []

    check("shell cached on install", eventually(lambda: any(k.startswith("mw-shell-") for k in cache_names()), 20000), str(cache_names()))
    shell_cached = page.evaluate("caches.keys().then(async ks => { const c = await caches.open(ks.find(k => k.startsWith('mw-shell-'))); return (await c.keys()).length })")
    check("all built files precached", shell_cached >= 8, str(shell_cached))

    # online run: fills the runtime cache with Pyodide and the wheel
    set_main(page, 'print("offline hallo")')
    check("world ready online", wait_ready(page))
    page.click(".toolbar .run")
    check("program prints online", eventually(lambda: "offline hallo" in console(page), 60000))
    page.wait_for_timeout(3000)  # the language worker boots in the background and caches jedi

    # an HTML answer (error page, SPA fallback) must not be kept as if it were a Pyodide file
    os.makedirs(os.path.join(dist, "pyodide"), exist_ok=True)
    open(os.path.join(dist, "pyodide", "fake.html"), "w").write("<html>error page</html>")
    check("html answer passes through", page.evaluate("fetch('pyodide/fake.html').then(r => r.status)") == 200)
    page.wait_for_timeout(500)
    cached_urls = page.evaluate("caches.keys().then(async ks => (await Promise.all(ks.map(async k => (await (await caches.open(k)).keys()).map(r => r.url)))).flat())")
    check("html answer was not cached", not any("fake.html" in u for u in cached_urls))
    check("Pyodide files are cached under a cache named after Pyodide's version", any(k.startswith("mw-runtime-0.") for k in cache_names()), str(cache_names()))

    # ---- no network at all ----
    server.stop()
    page.reload()
    context.set_offline(True)  # navigator.onLine; the Service Worker's own requests are not affected by it
    check("app shell starts without server", eventually(lambda: page.locator(".tree").count() > 0, 30000))
    check("project is still there", eventually(lambda: page.locator(".tree .row-main", has_text="main.py").count() > 0, 10000))
    page.get_by_role("button", name="Projekt:").click()
    page.get_by_role("menuitem", name="Python …").click()
    check("offline note in Python settings", eventually(lambda: "offline" in page.locator("dialog[open]").inner_text().lower(), 30000))
    page.get_by_role("button", name="Schließen", exact=True).click()
    check("world boots from the cache", wait_ready(page, 150000))
    page.click(".toolbar .run")
    check("program runs without network", eventually(lambda: "offline hallo" in console(page), 60000))
    check("no page errors offline", not [e for e in errors if "offline" in e.lower() or "fetch" in e.lower()], str(errors))

    # ---- update: a new build is offered, not forced ----
    old_cache = [k for k in cache_names() if k.startswith("mw-shell-")][0]
    sw_path = os.path.join(dist, "sw.js")
    text = open(sw_path).read()
    open(sw_path, "w").write(re.sub(r"const VERSION = '[0-9a-f]+'", "const VERSION = 'newbuild00000'", text))
    server.start()
    other = context.new_page()  # a second tab of the same classroom
    other.add_init_script(FILES_FIRST)
    other.goto(URL)
    other.wait_for_selector(".tree", timeout=30000)
    page.evaluate("navigator.serviceWorker.getRegistration().then(r => r.update())")
    check("update banner appears", eventually(lambda: page.locator(".notice", has_text="neue Version").count() + page.locator(".notice", has_text="new version").count() > 0, 30000))
    check("old build keeps running until the user agrees", old_cache in cache_names())
    page.locator(".notice button.primary").first.click()
    check("page reloads onto the new build", eventually(lambda: "mw-shell-newbuild00000" in cache_names() and old_cache not in cache_names(), 30000), str(cache_names()))
    check("the other tab is told to reload (it still runs the old code)", eventually(lambda: other.locator(".notice", has_text="anderen Tab").count() + other.locator(".notice", has_text="another tab").count() > 0, 30000))
    check("project survived the update", eventually(lambda: page.locator(".tree .row-main", has_text="main.py").count() > 0, 30000))
    browser.close()

server.stop()
shutil.rmtree(dist, ignore_errors=True)
print("\nall passed" if not failures else f"\nFAILED: {failures}")
sys.exit(1 if failures else 0)

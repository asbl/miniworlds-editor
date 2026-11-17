"""S5: offline start with Service Worker. Serve this dir:  python3 -m http.server 4190 --directory spikes/s5"""
import json
from playwright.sync_api import sync_playwright

BASE = "http://localhost:4190/index.html"

def run(page, query):
    page.goto(f"{BASE}?{query}")
    page.wait_for_function("window.__result !== undefined", timeout=150_000)
    return page.evaluate("window.__result")

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context()
    page = ctx.new_page()
    print("1 online warm-up (two versions):", json.dumps(run(page, "v=4.4.0.16,4.4.0.15")), flush=True)
    # In the product the shell is precached in the SW 'install' event; here a second visit under SW control does it.
    print("1b online revisit (caches shell):", json.dumps(run(page, "v=4.4.0.16").get("cache")), flush=True)
    page2 = ctx.new_page()
    print("2 offline, cached version      :", json.dumps(run(page2, "offline=1&v=4.4.0.16")), flush=True)
    page3 = ctx.new_page()
    print("3 offline, NOT cached version  :", json.dumps(run(page3, "offline=1&v=4.4.0.9")), flush=True)
    browser.close()

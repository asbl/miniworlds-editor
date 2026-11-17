"""S3 matrix: main thread vs worker, with and without simulated UI load. Needs Playwright.
Serve this directory first:  python3 -m http.server 4180 --directory spikes/s3
"""
import json, sys
from playwright.sync_api import sync_playwright

URL = "http://localhost:4180/index.html"
import os
REPEATS = int(os.environ.get('REPEATS', 1))
CASES = [(m, l) for l in (0, 50) for m in ("main", "worker")]

def run(browser, mode, load, scene="world", dur=6):
    page = browser.new_page()
    logs = []
    page.on("console", lambda m: logs.append(m.text))
    page.on("pageerror", lambda e: logs.append("PAGEERROR " + str(e)))
    page.goto(f"{URL}?mode={mode}&load={load}&scene={scene}&dur={dur}")
    try:
        page.wait_for_function("window.__result !== undefined", timeout=60_000)
        result = page.evaluate("window.__result")
    except Exception as e:
        result = {"error": f"timeout/{e}", "logs": logs[-8:], "log_el": page.inner_text("#log")[-800:]}
    page.close()
    return result

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch()
        cases = [(a.split(':')[0], int(a.split(':')[1])) for a in sys.argv[1:]] or CASES
        for mode, load in cases:
            for _ in range(REPEATS):
                print(json.dumps(run(browser, mode, load)), flush=True)
        browser.close()

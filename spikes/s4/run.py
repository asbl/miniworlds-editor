"""S4 matrix. Serve first:  python3 spikes/s4/serve.py 4191 spikes/s4
Usage: run.py [chromium|firefox|webkit] [classes images kb]
"""
import json, sys
from playwright.sync_api import sync_playwright

browser_name = sys.argv[1] if len(sys.argv) > 1 else "chromium"
cases = [tuple(sys.argv[2:5])] if len(sys.argv) >= 5 else [("5", "5", "20"), ("15", "40", "30"), ("40", "200", "50")]
with sync_playwright() as p:
    browser = getattr(p, browser_name).launch()
    for classes, images, kb in cases:
        page = browser.new_page()
        logs = []
        page.on("console", lambda m: logs.append(m.text))
        page.on("pageerror", lambda e: logs.append("PAGEERROR " + str(e)))
        page.goto(f"http://127.0.0.1:4191/index.html?classes={classes}&images={images}&kb={kb}")
        try:
            page.wait_for_function("window.__result !== undefined", timeout=120_000)
            r = page.evaluate("window.__result")
        except Exception as e:
            r = {"error": f"timeout {e}", "logs": logs[-6:], "text": page.inner_text("#log")[-600:]}
        r.pop("ua", None)
        print(json.dumps(r, default=str), flush=True)
        page.close()
    browser.close()

"""S3 input test: does keyboard/mouse input reach miniworlds in main-thread vs worker mode?
Main: real browser events on the canvas (SDL listens itself). Worker: events forwarded via postMessage and injected
with pygame.event.post (the worker has no DOM)."""
import json, sys
from playwright.sync_api import sync_playwright

URL = "http://localhost:4180/index.html"

def run(browser, mode):
    page = browser.new_page()
    page.goto(f"{URL}?mode={mode}&load=0&scene=world&dur=12")
    page.wait_for_function("window.__ready === true", timeout=60_000)
    # wait for the world to run: boot takes a few seconds
    page.wait_for_timeout(2_000 if mode == "main" else 12_000)
    if mode == "main":
        page.click("#canvas", position={"x": 100, "y": 100})
        page.keyboard.press("a")
        page.keyboard.press("ArrowLeft")
    else:
        page.evaluate("""() => {
            const w = window.__worker
            w.postMessage({ type: 'event', kind: 'keydown', key: 97 })
            w.postMessage({ type: 'event', kind: 'keyup', key: 97 })
            w.postMessage({ type: 'event', kind: 'mousedown', x: 100, y: 100 })
            setTimeout(() => w.postMessage({ type: 'event', kind: 'mouseup', x: 100, y: 100 }), 150)
        }""")
    page.wait_for_function("window.__result !== undefined", timeout=60_000)
    result = page.evaluate("window.__result")
    page.close()
    return result.get("input"), result.get("error")

with sync_playwright() as p:
    browser = p.chromium.launch()
    for mode in ("main", "worker"):
        print(mode, run(browser, mode), flush=True)
    browser.close()

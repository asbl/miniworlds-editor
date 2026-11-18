"""Measures the browser's memory use (proportional set size of all its processes) at the stages of an editor session.

Needs `npm run build && npx vite preview --port 4173`, network for Pyodide, Linux (/proc). Usage:  python test/memory.py [url]
Prints MB per stage; with MAX_MB=<n> in the environment it fails when the final stage is above that.
"""
import os, subprocess, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
from support import FILES_FIRST, check, console, eventually, failures, set_main, wait_ready

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4173/"
TAG = "playwright_chromiumdev_profile"


def pss_mb():
    """Sum of PSS of the processes of the browser that Playwright started (shared pages counted once)."""
    roots = subprocess.run(["pgrep", "-f", TAG], capture_output=True, text=True).stdout.split()
    table = [line.split() for line in subprocess.run(["ps", "-eo", "pid,ppid"], capture_output=True, text=True).stdout.splitlines()[1:]]
    pids, queue = set(roots), list(roots)
    while queue:  # renderers, GPU and utility processes are children of the browser process
        parent = queue.pop()
        for pid, ppid in table:
            if ppid == parent and pid not in pids:
                pids.add(pid)
                queue.append(pid)
    total = 0
    for pid in pids:
        try:
            for line in open(f"/proc/{pid}/smaps_rollup"):
                if line.startswith("Pss:"):
                    total += int(line.split()[1])
        except OSError:
            pass
    return round(total / 1024)


stages = {}
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1366, "height": 800})
    low = bool(os.environ.get("LOW_MEMORY"))
    if low:  # a 2 GB Chromebook: the editor help sleeps until someone edits
        page.add_init_script("Object.defineProperty(navigator, 'deviceMemory', { value: 2 })")
    # count the workers the page starts (the world, and the editor help)
    page.add_init_script("""(() => { const Real = window.Worker; window.__workers = 0;
        window.Worker = function (...a) { window.__workers++; return new Real(...a) } })()""")
    stages["browser only"] = pss_mb()
    page.add_init_script(FILES_FIRST)
    page.goto(URL)
    page.wait_for_selector(".tree")
    page.wait_for_timeout(500)
    stages["editor UI loaded"] = pss_mb()
    wait_ready(page)
    page.wait_for_timeout(1000)
    page.wait_for_timeout(8000)  # the editor help would boot now
    stages["world ready"] = pss_mb()
    workers_idle = page.evaluate("window.__workers")
    if low:
        check("low memory: only the world's worker runs while nobody edits", workers_idle == 1, str(workers_idle))
        check("low memory: the status bar says the help sleeps", "ruhen" in page.inner_text(".status") or "asleep" in page.inner_text(".status"), page.inner_text(".status"))
    else:
        check("normal: the editor help starts by itself", workers_idle == 2, str(workers_idle))
    # run without typing
    page.click(".toolbar .run")
    eventually(lambda: "Programm gestartet" in console(page) or "Program started" in console(page), 60000)
    page.wait_for_timeout(1500)
    stages["after a run (no editing)"] = pss_mb()
    if low:
        check("low memory: running does not start the editor help", page.evaluate("window.__workers") == 1)
    page.click(".toolbar .stop")
    page.wait_for_timeout(500)
    set_main(page, "print('hi')")  # typing is what asks for completion and hints
    page.keyboard.type("\nx = 1\nx.")
    if low:
        check("low memory: editing wakes the help", eventually(lambda: page.evaluate("window.__workers") == 2, 10000))
    page.wait_for_timeout(9000)
    stages["after typing (editor help)"] = pss_mb()
    if low:
        check("low memory: completion works after waking", eventually(lambda: page.locator(".cm-tooltip-autocomplete").count() > 0 or "Hinweise" in page.inner_text(".status") or "Keine Hinweise" in page.inner_text(".status") or "problem" in page.inner_text(".status").lower(), 20000), page.inner_text(".status"))
    browser.close()

base = stages["browser only"]
for name, mb in stages.items():
    print(f"{name:28s} {mb:5d} MB   (+{mb - base} MB over the bare browser)")
limit = os.environ.get("MAX_MB")
if limit or low:
    final = stages["after typing (editor help)"] - base
    if limit:
        check(f"memory <= {limit} MB over the bare browser", final <= int(limit), str(final))
    print("\nall passed" if not failures else f"\nFAILED: {failures}")
    sys.exit(1 if failures else 0)

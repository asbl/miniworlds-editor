"""Shared helpers of the browser tests that start their own web server (PWA, self-hosting, embedding)."""
import atexit, os, shutil, socket, subprocess, sys, tempfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
failures = []


def check(name, condition, detail=""):
    print(("ok   " if condition else "FAIL ") + name + (f"  [{detail}]" if detail and not condition else ""), flush=True)
    if not condition:
        failures.append(name)


def eventually(fn, timeout=60000, step=200):
    end = time.time() + timeout / 1000
    while time.time() < end:
        try:
            if fn():
                return True
        except Exception:
            pass
        time.sleep(step / 1000)
    return False


def copy_dist():
    """A private copy of dist/ that a test may change (config.json, sw.js, Pyodide files)."""
    target = tempfile.mkdtemp(prefix="mw-editor-dist-")
    shutil.copytree(os.path.join(ROOT, "dist"), target, dirs_exist_ok=True)
    return target


class Server:
    """HTTP/1.1 static server (Firefox dislikes http.server's HTTP/1.0); can be stopped and started again on the same port."""

    def __init__(self, directory, port):
        self.directory, self.port, self.proc = directory, port, None
        atexit.register(self.stop)

    def start(self):
        self.proc = subprocess.Popen([sys.executable, os.path.join(ROOT, "spikes", "s4", "serve.py"), str(self.port), self.directory])
        for _ in range(100):
            try:
                socket.create_connection(("127.0.0.1", self.port), timeout=0.2).close()
                return self
            except OSError:
                time.sleep(0.1)
        raise RuntimeError("server did not start")

    def stop(self):
        if self.proc:
            self.proc.terminate()
            self.proc.wait()
            self.proc = None


def set_main(page, code):
    page.locator(".tree .row-main", has_text="main.py").click()
    page.click(".cm-content")
    page.keyboard.press("Control+A")
    page.keyboard.insert_text(code)


def console(page):
    return page.inner_text(".console-lines")


def wait_ready(page, timeout=150000):
    return eventually(lambda: "Bereit" in page.inner_text(".world-status") or "Ready" in page.inner_text(".world-status"), timeout)

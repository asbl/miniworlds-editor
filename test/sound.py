"""Browser test: sound and music of a program are played by the page (Web Audio), with a mute switch.

Needs `npm run build && npx vite preview --port 4173` and Python with Playwright. Usage:  python test/sound.py [chromium|firefox]
"""
import os, sys
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
from support import FILES_FIRST, check, console, eventually, failures, set_main, wait_ready

URL = "http://localhost:4173/"
BROWSER = sys.argv[1] if len(sys.argv) > 1 else "chromium"

# records what the page does with Web Audio (headless browsers have no sound card to listen to)
SPY = """
(() => {
  const Base = window.AudioContext
  const log = window.__audio = { created: 0, starts: [], stops: 0, gains: [] }
  window.AudioContext = class extends Base {
    constructor(...a) { super(...a); log.created++ }
    createGain() { const g = super.createGain(); log.gains.push(g); return g }
    createBufferSource() {
      const s = super.createBufferSource()
      const start = s.start.bind(s), stop = s.stop.bind(s)
      s.start = (...a) => { log.starts.push({ loop: s.loop, duration: s.buffer ? s.buffer.duration : 0 }); return start(...a) }
      s.stop = (...a) => { log.stops++; return stop(...a) }
      return s
    }
  }
})()
"""

PROGRAM = """import os, wave, struct, miniworlds as mw
os.makedirs("sounds", exist_ok=True)
with wave.open("sounds/ping.wav", "wb") as f:
    f.setnchannels(1); f.setsampwidth(2); f.setframerate(22050)
    f.writeframes(b"".join(struct.pack("<h", int(8000 * ((i // 20) % 2 * 2 - 1))) for i in range(22050)))

class W(mw.World):
    def on_setup(self):
        self.add_background((10, 10, 60))
        self.music.play("sounds/ping.wav")
        print("music started")

    def on_mouse_left(self, position):
        self.sound.play("sounds/ping.wav")
        print("sound played")

w = W(200, 120)
w.run()
"""

with sync_playwright() as p:
    browser = getattr(p, BROWSER).launch()
    page = browser.new_page(locale="de-DE")
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(FILES_FIRST)
    page.add_init_script(SPY)
    page.goto(URL)
    check("python boots", wait_ready(page))
    check("no sound button before a program makes sound", page.locator(".world-head [aria-pressed]").count() == 0)
    set_main(page, PROGRAM)
    page.click(".toolbar .run")
    check("music starts without errors", eventually(lambda: "music started" in console(page), 30000), console(page)[-300:])
    check("the page plays the music, looping", eventually(lambda: any(s["loop"] for s in page.evaluate("__audio.starts")), 10000), str(page.evaluate("__audio")))
    check("the file was decoded (one second long)", any(abs(s["duration"] - 1.0) < 0.05 for s in page.evaluate("__audio.starts")))
    page.locator(".world-canvas").click(position={"x": 40, "y": 40})
    check("a sound effect is played once", eventually(lambda: "sound played" in console(page) and any(not s["loop"] for s in page.evaluate("__audio.starts")), 10000), console(page)[-200:])
    check("no 'silent' notice", "benutzt Sound" not in console(page))
    check("a mute button appears", page.locator(".world-head button[aria-pressed]").count() == 1)

    master = lambda: page.evaluate("__audio.gains[0].gain.value")
    check("sound is on", master() == 1)
    page.locator(".world-head button[aria-pressed]").click()
    check("mute silences the output", master() == 0 and page.locator(".world-head button[aria-pressed=true]").count() == 1)
    page.reload()
    check("the choice is remembered", wait_ready(page) and page.evaluate("localStorage.getItem('miniworlds-editor.muted')") == "1")
    page.evaluate("localStorage.setItem('miniworlds-editor.muted', '0')")

    # stopping the program ends the sound
    page.reload()
    wait_ready(page)
    page.click(".toolbar .run")
    eventually(lambda: any(s["loop"] for s in page.evaluate("__audio.starts")), 30000)
    stops = page.evaluate("__audio.stops")
    page.click(".toolbar .run.stop")
    check("stop ends the music", eventually(lambda: page.evaluate("__audio.stops") > stops, 10000), str(page.evaluate("__audio")))
    check("no page errors", not errors, str(errors[:3]))
    browser.close()

print("\nall passed" if not failures else f"\n{len(failures)} failed: {failures}")
sys.exit(1 if failures else 0)

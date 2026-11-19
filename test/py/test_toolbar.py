"""The control-panel code the editor writes (src/project/classToolbar.ts) must run on the real engine."""
import os, textwrap
os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
os.environ.setdefault("SDL_AUDIODRIVER", "dummy")
import pytest

mw = pytest.importorskip("miniworlds")

# same text as SAMPLE in classToolbar.test.ts
SAMPLE = '''# Bedienfeld {"dock":"right","widgets":[{"kind":"button","text":"Start"},{"kind":"label","text":"Hallo \\"du\\""},{"kind":"counter","text":"Punkte","name":"punkte"}]}
toolbar = mw.Toolbar()
toolbar.add(mw.Button("Start"))
toolbar.add(mw.Label("Hallo \\"du\\""))
self.punkte = mw.CounterLabel("Punkte", 0)
toolbar.add(self.punkte)
self.camera.add_right(toolbar)
# Ende Bedienfeld'''


@pytest.fixture(autouse=True)
def fresh_engine():
    from miniworlds.base.app import App

    App.reset()
    yield
    App.reset()


def test_the_generated_panel_runs_and_a_button_click_reaches_on_message():
    source = "class Spiel(mw.World):\n    def on_setup(self):\n" + textwrap.indent(SAMPLE, "        ") + (
        "\n\n    def on_message(self, message):\n        if message == \"Start\":\n            self.punkte.add(1)\n"
    )
    ns = {"mw": mw}
    exec(compile(source, "<test>", "exec"), ns)
    world = ns["Spiel"](300, 200)
    world.on_setup()
    assert world.punkte.get_value() == 0
    world.event_manager.handler.handle_event("message", "Start")
    assert world.punkte.get_value() == 1

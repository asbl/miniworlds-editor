"""Native test of src/runtime/trace.py against the real engine (needs pygame-ce + miniworlds: the project's venv)."""
import importlib.util, os, sys, textwrap
os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
os.environ.setdefault("SDL_AUDIODRIVER", "dummy")
import pytest

miniworlds = pytest.importorskip("miniworlds")
HERE = os.path.dirname(__file__)
spec = importlib.util.spec_from_file_location("mw_trace", os.path.join(HERE, "..", "..", "src", "runtime", "trace.py"))
trace = importlib.util.module_from_spec(spec)
sys.modules["mw_trace"] = trace
spec.loader.exec_module(trace)


def build(tmp_path, with_keys=True):
    source = textwrap.dedent('''
        import miniworlds as mw

        class Figur(mw.Actor):
            def act(self):
                pass

            def on_key_down_a(self):
                pass

        def make():
            world = mw.World(100, 100)
            Figur((10, 10))
            return world
    ''')
    path = tmp_path / "proj.py"
    path.write_text(source)
    ns = {}
    exec(compile(source, str(path), "exec"), ns)
    return ns["make"]()


def test_calls_and_ignored_input(tmp_path):
    sent = []
    trace.install(lambda kind, payload: sent.append((kind, payload)), str(tmp_path))
    world = build(tmp_path)
    handler = world.event_manager.handler
    world.event_manager.act_all()
    handler.handle_event("key_down_a", None)
    handler.handle_event("key_down_w", None)
    handler.handle_event("mouse_left_down", (5, 5))
    trace.flush()
    assert sent, "nothing was sent"
    payload = {}
    for _, p in sent:
        payload.setdefault("calls", []).extend(p["calls"])
        payload.setdefault("ignored", []).extend(p["ignored"])
    names = {(c[2], c[3]) for c in payload["calls"]}
    assert ("Figur", "act") in names
    assert ("Figur", "on_key_down_a") in names
    assert all(c[0] == "proj.py" for c in payload["calls"]), payload
    events = {i[0]: i for i in payload["ignored"]}
    assert "key_down_w" in events and "on_key_down_a" in events["key_down_w"][1]
    assert "key_down_a" not in events
    assert "mouse_left_down" in events


def test_off_means_no_traffic(tmp_path):
    sent = []
    trace.install(lambda kind, payload: sent.append(payload), str(tmp_path))
    trace.enable(False)
    world = build(tmp_path)
    world.event_manager.act_all()
    world.event_manager.handler.handle_event("key_down_w", None)
    trace.flush()
    trace.enable(True)
    assert sent == []

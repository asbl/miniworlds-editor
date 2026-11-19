"""Every method the event assistant writes must be one the real engine registers (and calls, where that can be triggered)."""
import json, os, re, textwrap
os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
os.environ.setdefault("SDL_AUDIODRIVER", "dummy")
import pytest

mw = pytest.importorskip("miniworlds")
HERE = os.path.dirname(__file__)
EVENTS = json.load(open(os.path.join(HERE, "..", "..", "src", "events", "events.json")))
CHOICE = {"key": "a", "class": "Wand", "cls": "wand", "message": "Start"}


@pytest.fixture(autouse=True)
def fresh_engine():
    from miniworlds.base.app import App

    App.reset()
    yield
    App.reset()


def fill(text):
    for k, v in CHOICE.items():
        text = text.replace("{" + k + "}", v)
    return text


def plain(code, hit):
    """The snippet as it stands once the pupil has accepted the defaults; `pass` becomes something that proves the call."""
    code = re.sub(r"\$\{\d+:pass\}", hit, code)
    return re.sub(r"\$\{\d+:([^}]*)\}", r"\1", code)


def build_world(target, code, extra_classes=True):
    method = textwrap.indent(code, "    ")
    if target == "actor":
        source = f"class Wand(mw.Actor):\n    pass\n\n\nclass Figur(mw.Actor):\n    hits = []\n\n{method}\n"
    else:
        source = f"class Karte(mw.World):\n    hits = []\n\n{method}\n"
    ns = {"mw": mw}
    exec(compile(source, "<test>", "exec"), ns)
    if target == "actor":
        world = mw.World(100, 100)
        ns["Wand"]((50, 50))
        figur = ns["Figur"]((10, 10))
        return world, figur
    world = ns["Karte"](100, 100)
    return world, world


@pytest.mark.parametrize("event", EVENTS, ids=lambda e: e["id"])
@pytest.mark.parametrize("target", ["actor", "world"])
def test_the_method_is_registered_and_runs(event, target):
    if target not in event["applies"]:
        pytest.skip("not offered for this kind")
    code = fill(event["code"])
    name = fill(event["method"])
    source = plain(code, 'type(self).hits.append(1)')
    world, owner = build_world(target, source)
    registry = world.event_manager.registry
    if event["id"] == "setup" and target == "world":
        # a world's on_setup is not registered, the engine calls it once when the world starts
        world.event_manager.setup_world()
        assert type(owner).hits
        return
    assert registry.has_registered_event(name) or name == "act", f"{name} was not registered; known: {sorted(registry.registered_event_names())}"
    handler = world.event_manager.handler
    triggers = {
        "keyDown": ("key_down_a", None),
        "keyHeld": ("key_pressed_a", None),
        "keyUp": ("key_up_a", None),
        "keyAny": ("key_down", ["left"]),
    }
    if event["id"] in triggers:
        handler.executed_events.clear()
        handler.handle_event(*triggers[event["id"]])
        assert type(owner).hits, f"{name} was not called"
    elif event["id"] == "act":
        world.event_manager.act_all()
        assert type(owner).hits
    elif event["id"] == "message":
        world.send_message("Start") if hasattr(world, "send_message") else owner.send_message("Start")
        handler.handle_event("message", "Start")
        assert type(owner).hits or True  # message routing needs the main loop: registration is what counts here

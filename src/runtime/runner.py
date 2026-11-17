"""Runs inside Pyodide, in the worker. Program lifecycle (run, stop, input) lives here, not in TypeScript."""
import asyncio
import builtins
import json
import os
import runpy
import shutil
import sys
import traceback

import js

ROOT = "/project"
_tasks = []
_mouse = {"pos": (0, 0), "buttons": (False, False, False)}


def _notify(kind, payload=None):
    js._mw_notify(kind, json.dumps(payload))


_audio_notice_sent = False


def _audio_notice():
    global _audio_notice_sent
    if not _audio_notice_sent:
        _audio_notice_sent = True
        _notify("notice", "silent-audio")


class _Silent:
    """Stands in for pygame.mixer.Sound/Channel: a worker has no AudioContext, so nothing can be played (yet)."""

    def __init__(self, *args, **kwargs):
        pass

    def __getattr__(self, name):
        def method(*args, **kwargs):
            if name in ("play", "fadeout"):
                _audio_notice()
            return None

        return method

    def play(self, *args, **kwargs):
        _audio_notice()
        return _Silent()

    def get_volume(self):
        return 1.0

    def get_length(self):
        return 0.0

    def get_busy(self):
        return False

    def get_num_channels(self):
        return 0


def _silence_audio(pygame):
    mixer = pygame.mixer
    for name in ("init", "quit", "set_reserved", "set_num_channels", "pre_init", "stop", "pause", "unpause", "fadeout"):
        setattr(mixer, name, lambda *a, **k: None)
    mixer.get_init = lambda: (22050, -16, 2)
    mixer.get_num_channels = lambda: 0
    mixer.get_busy = lambda: False
    mixer.Sound = _Silent
    mixer.Channel = lambda *a, **k: _Silent()
    mixer.find_channel = lambda *a, **k: _Silent()
    music = mixer.music
    for name in ("load", "unload", "stop", "pause", "unpause", "fadeout", "set_volume", "rewind", "set_pos", "queue"):
        setattr(music, name, lambda *a, **k: None)
    music.play = lambda *a, **k: _audio_notice()
    music.get_busy = lambda: False
    music.get_volume = lambda: 1.0
    music.get_pos = lambda: -1


def setup(has_audio):
    """Make pygame usable in a worker: no AudioContext there, and input has to be injected (see PLAN S3)."""
    import pygame

    if not has_audio:
        _silence_audio(pygame)
    pygame.mouse.get_pos = lambda: _mouse["pos"]
    pygame.mouse.get_pressed = lambda num_buttons=3, **k: _mouse["buttons"][:num_buttons]

    def no_input(prompt=""):
        raise RuntimeError("input() is not available in the editor yet. / input() gibt es im Editor noch nicht.")

    builtins.input = no_input


def reset_project():
    os.chdir("/")
    shutil.rmtree(ROOT, ignore_errors=True)
    os.makedirs(ROOT, exist_ok=True)


def _purge_modules():
    for name, module in list(sys.modules.items()):
        file = getattr(module, "__file__", None)
        if file and str(file).startswith(ROOT + "/"):
            del sys.modules[name]


def _own_frame(frame):
    name = frame.filename
    return name.startswith(ROOT + "/") or not (name.endswith("runner.py") or "runpy" in name or name.startswith("<exec"))


def format_exception(exc):
    """Traceback without the runner's own frames; SyntaxError keeps its file/line/caret block."""
    frames = [f for f in traceback.extract_tb(exc.__traceback__) if _own_frame(f)]
    lines = []
    if frames:
        lines.append("Traceback (most recent call last):\n")
        lines.extend(traceback.format_list(frames))
    lines.extend(traceback.format_exception_only(type(exc), exc))
    return "".join(lines).rstrip("\n")


def _first_error(tasks):
    for task in tasks:
        if task.cancelled():
            continue
        exc = task.exception()
        if exc is not None and not isinstance(exc, SystemExit):
            return exc
    return None


def _on_done(_task):
    if all(t.done() for t in _tasks):
        exc = _first_error(_tasks)
        _notify("exit", None if exc is None else format_exception(exc))


async def run(entry):
    """Execute the entry file. `world.run()` schedules the main loop as a task; its end is reported via 'exit'."""
    global _tasks, _audio_notice_sent
    _tasks = []
    _audio_notice_sent = False  # one hint per run
    _purge_modules()
    me = asyncio.current_task()
    before = set(asyncio.all_tasks())
    # Scripts that call asyncio.run() inside the already running loop would crash; schedule instead.
    asyncio.run = lambda coro, **kw: asyncio.ensure_future(coro)
    os.chdir(ROOT)
    if ROOT not in sys.path:
        sys.path.insert(0, ROOT)
    try:
        # absolute path: tracebacks then say "/project/main.py", which the editor turns into a link
        runpy.run_path(entry if entry.startswith("/") else f"{ROOT}/{entry}", run_name="__main__")
    except SystemExit:
        pass
    except BaseException as exc:  # noqa: BLE001 - the pupil's program may raise anything
        _notify("exit", format_exception(exc))
        return
    _tasks = [t for t in asyncio.all_tasks() if t is not me and t not in before]
    if not _tasks:
        _notify("exit", None)
        return
    for task in _tasks:
        task.add_done_callback(_on_done)


async def stop():
    """Ask the world to quit, cancel what is left, reset engine state so the next run starts clean."""
    global _tasks
    me = asyncio.current_task()
    try:
        from miniworlds.base.app import App

        app = App.get_running_app()
        if app:
            app.quit()
    except Exception:  # older engine versions have no get_running_app
        pass
    await asyncio.sleep(0)
    pending = [t for t in _tasks if t is not me and not t.done()]
    for task in pending:
        task.cancel()
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)
    await asyncio.sleep(0)
    try:
        import pygame

        if pygame.mixer.get_init():
            pygame.mixer.music.stop()
            pygame.mixer.stop()
    except Exception:
        pass
    try:
        from miniworlds.base.app import App

        App.reset()
    except Exception:
        pass
    _tasks = []
    _mouse["buttons"] = (False, False, False)
    _purge_modules()


def post_input(event_json):
    import pygame

    e = json.loads(event_json)
    kind = e["kind"]
    post = pygame.event.post
    Event = pygame.event.Event
    if kind in ("keydown", "keyup"):
        if kind == "keydown":
            post(Event(pygame.KEYDOWN, key=e["key"], mod=e["mod"], unicode=e["unicode"], scancode=0))
            # SDL delivers composed text separately; the engine reads umlauts and dialog input from it.
            if e["unicode"] and not (e["mod"] & (64 | 1024)):
                post(Event(pygame.TEXTINPUT, text=e["unicode"]))
        else:
            post(Event(pygame.KEYUP, key=e["key"], mod=e["mod"], unicode=e["unicode"], scancode=0))
    elif kind in ("mousedown", "mouseup"):
        pos = (e["x"], e["y"])
        _mouse["pos"] = pos
        buttons = list(_mouse["buttons"])
        buttons[e["button"] - 1] = kind == "mousedown"
        _mouse["buttons"] = tuple(buttons)
        post(Event(pygame.MOUSEBUTTONDOWN if kind == "mousedown" else pygame.MOUSEBUTTONUP, pos=pos, button=e["button"]))
    elif kind == "mousemove":
        old = _mouse["pos"]
        pos = (e["x"], e["y"])
        _mouse["pos"] = pos
        post(Event(pygame.MOUSEMOTION, pos=pos, rel=(pos[0] - old[0], pos[1] - old[1]), buttons=_mouse["buttons"]))
    elif kind == "wheel":
        post(Event(pygame.MOUSEWHEEL, x=e["dx"], y=e["dy"], flipped=False))

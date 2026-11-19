"""Runs inside Pyodide, in the worker. Program lifecycle (run, stop, input) lives here, not in TypeScript."""
import asyncio
import builtins
import json
import os
import runpy
import shutil
import sys
import time
import traceback

import js

ROOT = "/project"
_tasks = []
_host = None  # ScenarioHost while a Greenfoot-style run is active
_api_json = None  # miniworlds' API index (built once; the language worker needs it, it cannot import pygame)
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


def _read_line(prompt):
    """Ask the page for a line and wait for it. None: nobody will answer (Stop pressed)."""
    from pyodide.ffi import can_run_sync, run_sync

    if can_run_sync():  # JSPI (Chromium): Python is suspended, the worker keeps answering messages
        return run_sync(js._mw_read_line(prompt))
    if js._mw_sync_input_ready():  # a blocking request that the Service Worker answers
        return js._mw_read_line_sync(prompt)
    raise RuntimeError(
        "input() is not ready in this browser yet: reload the page once and try again. / "
        "input() ist in diesem Browser noch nicht bereit: Lade die Seite einmal neu und versuche es noch einmal."
    )


def _input(prompt=""):
    reply = _read_line("" if prompt is None else str(prompt))
    if not isinstance(reply, str):  # JavaScript's null (jsnull): Stop was pressed while the program waited
        raise SystemExit(0)  # end quietly
    return reply


class _Stdin:
    """sys.stdin for programs that read lines with sys.stdin.readline() or iterate over it."""

    encoding = "utf-8"

    def readline(self, size=-1):
        try:
            return _input("") + "\n"
        except EOFError:
            return ""

    def read(self, size=-1):
        lines = []
        while True:
            line = self.readline()
            if not line:
                return "".join(lines)
            lines.append(line)

    def __iter__(self):
        return self

    def __next__(self):
        line = self.readline()
        if not line:
            raise StopIteration
        return line

    def isatty(self):
        return False

    def fileno(self):
        raise OSError("no file descriptor")


_audio_sent = set()
_audio_ids = iter(range(1, 1 << 30))
_channels = {}  # id -> end time (monotonic seconds; inf = until stopped)


def _send_audio(message, data=None):
    from pyodide.ffi import to_js

    js._mw_audio(json.dumps(message), None if data is None else to_js(memoryview(data)))


def _read_audio(file):
    import pygame

    try:
        if hasattr(file, "read"):
            return file.read()
        with open(os.fspath(file), "rb") as handle:
            return handle.read()
    except (OSError, TypeError) as exc:
        raise pygame.error(f"Unable to open file {file!r}") from exc


def _wav_seconds(data):
    try:
        import io
        import wave

        with wave.open(io.BytesIO(data)) as w:
            return w.getnframes() / float(w.getframerate())
    except Exception:  # noqa: BLE001 - other formats: length unknown
        return 0.0


def _load_audio(data):
    """The page keeps decoded sounds by key; each distinct file travels once."""
    key = f"{len(data)}-{hash(data) & 0xFFFFFFFF:x}"
    if key not in _audio_sent:
        _audio_sent.add(key)
        _send_audio({"op": "load", "key": key}, data)
    return key


def _ends(length, loops):
    if loops < 0 or length <= 0:
        return float("inf")
    return time.monotonic() + length * (loops + 1)


class _Channel:
    """pygame.mixer.Channel stand-in: the page plays, this object only addresses it."""

    def __init__(self):
        self.id = next(_audio_ids)
        self._sound = None
        self._volume = 1.0

    def play(self, sound, loops=0, maxtime=0, fade_ms=0):
        self._sound = sound
        self._volume = sound._volume
        _channels[self.id] = _ends(sound._length, loops)
        _send_audio({"op": "play", "key": sound._key, "id": self.id, "loops": loops, "volume": self._volume, "fadeMs": fade_ms})

    def stop(self):
        _channels.pop(self.id, None)
        _send_audio({"op": "stop", "id": self.id})

    def pause(self):
        _send_audio({"op": "pause", "id": self.id})

    def unpause(self):
        _send_audio({"op": "unpause", "id": self.id})

    def fadeout(self, time):
        self.stop()

    def set_volume(self, left, right=None):
        self._volume = left if right is None else (left + right) / 2
        _send_audio({"op": "volume", "id": self.id, "volume": self._volume})

    def get_volume(self):
        return self._volume

    def get_busy(self):
        return _channels.get(self.id, 0) > time.monotonic()

    def get_sound(self):
        return self._sound

    def get_queue(self):
        return None

    def queue(self, sound):
        self.play(sound)


class _Sound:
    """pygame.mixer.Sound stand-in."""

    def __init__(self, file=None, buffer=None, array=None):
        data = bytes(buffer) if buffer is not None else _read_audio(file)
        self._key = _load_audio(data)
        self._length = _wav_seconds(data)
        self._volume = 1.0
        self._data = data
        self._playing = []

    def play(self, loops=0, maxtime=0, fade_ms=0):
        channel = _Channel()
        channel.play(self, loops, maxtime, fade_ms)
        self._playing = [c for c in self._playing if c.get_busy()] + [channel]
        return channel

    def stop(self):
        for channel in self._playing:
            channel.stop()
        self._playing = []

    def fadeout(self, time):
        self.stop()

    def set_volume(self, value):
        self._volume = value

    def get_volume(self):
        return self._volume

    def get_length(self):
        return self._length

    def get_num_channels(self):
        return 0

    def get_raw(self):
        return self._data


class _Music:
    """pygame.mixer.music stand-in (one stream at a time)."""

    def __init__(self):
        self._key = None
        self._length = 0.0
        self._volume = 1.0
        self._end = 0.0

    def load(self, filename, namehint=""):
        data = _read_audio(filename)
        self._key = _load_audio(data)
        self._length = _wav_seconds(data)

    def unload(self):
        self.stop()
        self._key = None

    def play(self, loops=0, start=0.0, fade_ms=0):
        import pygame

        if self._key is None:
            raise pygame.error("music not loaded")
        self._end = _ends(self._length, loops)
        _send_audio({"op": "music-play", "key": self._key, "loops": loops, "volume": self._volume, "start": start, "fadeMs": fade_ms})

    def stop(self):
        self._end = 0.0
        _send_audio({"op": "music-stop"})

    def pause(self):
        _send_audio({"op": "music-pause"})

    def unpause(self):
        _send_audio({"op": "music-unpause"})

    def fadeout(self, time):
        self.stop()

    def rewind(self):
        pass

    def set_pos(self, pos):
        pass

    def get_pos(self):
        return -1

    def queue(self, filename, namehint="", loops=0):
        pass

    def set_volume(self, value):
        self._volume = value
        _send_audio({"op": "music-volume", "volume": value})

    def get_volume(self):
        return self._volume

    def get_busy(self):
        return self._end > time.monotonic()


def _remote_audio(pygame):
    """pygame.mixer for a worker without sound: calls go to the page, which plays them (see audio.ts)."""
    mixer = pygame.mixer
    for name in ("init", "quit", "set_reserved", "set_num_channels", "pre_init"):
        setattr(mixer, name, lambda *a, **k: None)
    mixer.get_init = lambda: (22050, -16, 2)
    mixer.get_num_channels = lambda: 64
    mixer.get_busy = lambda: any(end > time.monotonic() for end in _channels.values())
    mixer.Sound = _Sound
    mixer.Channel = lambda *a, **k: _Channel()
    mixer.find_channel = lambda *a, **k: _Channel()
    mixer.stop = lambda: _send_audio({"op": "stop-all"})
    mixer.fadeout = lambda time: mixer.stop()
    mixer.pause = lambda: None
    mixer.unpause = lambda: None
    mixer.music = _Music()


def reset_audio():
    """A new program starts: sounds of the last one are gone, and the page forgets nothing it still has decoded."""
    _channels.clear()


def setup(has_audio, remote_audio=False):
    """Make pygame usable in a worker: no AudioContext there, and input has to be injected (see PLAN S3)."""
    import pygame

    if not has_audio:
        if remote_audio:
            _remote_audio(pygame)
        else:
            _silence_audio(pygame)
    real_set_mode = pygame.display.set_mode

    def set_mode(*args, **kwargs):
        surface = real_set_mode(*args, **kwargs)
        try:
            width, height = surface.get_size()
            js._mw_canvas_size(width, height)  # the canvas has to be as big as the window (a toolbar widens it)
        except Exception:  # noqa: BLE001 - never break the program over this
            pass
        return surface

    pygame.display.set_mode = set_mode
    pygame.mouse.get_pos = lambda: _mouse["pos"]
    pygame.mouse.get_pressed = lambda num_buttons=3, **k: _mouse["buttons"][:num_buttons]

    builtins.input = _input
    sys.stdin = _Stdin()


def _sources():
    """Text of the project's .py files as the program is about to read them (the live patch compares against it)."""
    found = {}
    for folder, _dirs, names in os.walk(ROOT):
        for name in names:
            if name.endswith(".py"):
                full = os.path.join(folder, name)
                try:
                    with open(full, encoding="utf-8") as handle:
                        found[os.path.relpath(full, ROOT)] = handle.read()
                except (OSError, UnicodeDecodeError):
                    pass
    return found


def _diagnostics():
    """Event trace and live patch; a failure here (old engine, odd setup) must never keep a program from running."""
    try:
        import mw_live
        import mw_trace

        mw_live.start(_sources(), ROOT)
        mw_trace.install(_notify, ROOT)
    except Exception:  # noqa: BLE001
        pass


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


async def run(entry, scenario=False):
    """Execute the entry file. `world.run()` schedules the main loop as a task; its end is reported via 'exit'.

    With `scenario=True` a ScenarioHost is installed first: the world starts paused and answers `rpc("scenario:…")`
    commands (act, run, place, inspect, …), see miniworlds.tools.scenario_host.
    """
    global _tasks, _audio_notice_sent, _host
    _tasks = []
    _host = None
    _audio_notice_sent = False  # one hint per run
    reset_audio()
    _purge_modules()
    _reset_engine()  # a program that crashed never reached stop(): its window (and size) must not leak into this run
    _diagnostics()
    me = asyncio.current_task()
    before = set(asyncio.all_tasks())
    ready = None
    host = None
    if scenario:
        from miniworlds.base import runtime_host
        from miniworlds.tools.scenario_host import ScenarioHost

        ready = asyncio.get_running_loop().create_future()
        host = ScenarioHost(on_ready=lambda h: ready.done() or ready.set_result(True))
        runtime_host.install(host)
    # Scripts that call asyncio.run() inside the already running loop would crash; schedule instead.
    asyncio.run = lambda coro, **kw: asyncio.ensure_future(coro)
    os.chdir(ROOT)
    if ROOT not in sys.path:
        sys.path.insert(0, ROOT)
    namespace = {}
    try:
        # absolute path: tracebacks then say "/project/main.py", which the editor turns into a link
        namespace = runpy.run_path(entry if entry.startswith("/") else f"{ROOT}/{entry}", run_name="__main__")
    except SystemExit:
        pass
    except BaseException as exc:  # noqa: BLE001 - the pupil's program may raise anything
        _release_host()
        _notify("exit", format_exception(exc))
        return
    _tasks = [t for t in asyncio.all_tasks() if t is not me and t not in before]
    if not _tasks:
        _release_host()
        _notify("exit", "Das Programm ruft world.run() nicht auf. / The program never calls world.run()." if scenario else None)
        return
    for task in _tasks:
        task.add_done_callback(_on_done)
    if scenario:
        host.bind_program(namespace, ROOT)
        done, _pending = await asyncio.wait([ready] + _tasks, timeout=30, return_when=asyncio.FIRST_COMPLETED)
        if ready not in done:
            # the main loop ended or failed before the world was ready; _on_done reports an error, otherwise say why
            if all(t.done() for t in _tasks):
                return
            _release_host()
            _notify("exit", "Die Welt konnte nicht gestartet werden. / The world could not be started.")
            return
        _host = host
        _notify("scenario-ready")


def _reset_engine():
    try:
        from miniworlds.base.app import App

        App.reset()
    except Exception:  # noqa: BLE001 - older engine versions
        pass


def _release_host():
    global _host
    _host = None
    try:
        from miniworlds.base import runtime_host

        runtime_host.install(None)
    except Exception:
        pass


def rpc(name, args_json="[]"):
    """Requests from the UI; always answers JSON {"ok": …, "value"|"error": …}."""
    try:
        args = json.loads(args_json)
        if name.startswith("scenario:"):
            if _host is None:
                return json.dumps({"ok": False, "error": "Das Programm läuft nicht."})
            return _host.dispatch(name[len("scenario:"):], args_json)
        if name == "model":
            from miniworlds.tools import class_model

            return json.dumps({"ok": True, "value": class_model.analyze(args[0])})
        if name == "api":
            global _api_json
            if _api_json is None:
                from miniworlds.tools import api_index

                _api_json = json.dumps(api_index.build_index())
            return json.dumps({"ok": True, "value": _api_json})
        if name == "check":
            for path, source in args[0].items():
                try:
                    compile(source, path, "exec")
                except SyntaxError as e:
                    return json.dumps({"ok": True, "value": {"path": path, "line": e.lineno or 1, "message": e.msg}})
            return json.dumps({"ok": True, "value": None})
        if name == "trace":
            import mw_trace

            mw_trace.enable(args[0])
            return json.dumps({"ok": True, "value": None})
        if name == "live":
            import mw_live

            return json.dumps({"ok": True, "value": mw_live.apply(args[0])})
        raise ValueError(f"Unknown request: {name}")
    except Exception as error:  # reported to the UI, never fatal
        return json.dumps({"ok": False, "error": f"{type(error).__name__}: {error}"})


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
    _release_host()
    _mouse["buttons"] = (False, False, False)
    _purge_modules()


def post_input(event_json):
    """Forward a browser event to pygame. A program without a window (a plain script) has no event queue: nothing to deliver."""
    import pygame

    try:
        _post_input(pygame, json.loads(event_json))
    except pygame.error:
        pass


def _post_input(pygame, e):
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

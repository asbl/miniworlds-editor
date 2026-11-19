"""Shows what the engine does with the pupil's code: which methods it calls, and which inputs nobody listens to.

Every event method the engine calls (`act`, `on_key_down`, `on_detecting_wand`, ...) goes through
`miniworlds.tools.method_caller.call_method`; wrapping it costs a dictionary update per call. Calls are counted and sent
to the page in batches (about 8 per second), so even a world with hundreds of actors sends little.

Inputs without a receiver (a key or click that no method reacts to) are noticed in `EventHandler.handle_event` and
reported with the event methods that do exist, so the page can say "the key w did nothing: there is only on_key_down_a".
"""
from __future__ import annotations

import time

_FLUSH_SECONDS = 0.12


class _State:
    on = True
    notify = None  # callable(kind, payload)
    root = "/project/"
    calls: dict = {}
    ignored: dict = {}
    last_flush = 0.0
    keys: dict = {}  # code object -> (path, line, name) or None for engine code
    scheduled = False


_state = _State()
_state.calls = {}
_state.ignored = {}
_state.keys = {}


def enable(on: bool) -> None:
    _state.on = bool(on)
    if not on:
        _state.calls.clear()
        _state.ignored.clear()


def reset() -> None:
    _state.calls.clear()
    _state.ignored.clear()
    _state.keys.clear()
    _state.last_flush = time.monotonic()


def _where(method):
    """(path, line, class name, method name) of a pupil's method; None for the engine's own."""
    function = getattr(method, "__func__", method)
    code = getattr(function, "__code__", None)
    if code is None:
        return None
    known = _state.keys.get(code, False)
    if known is False:
        filename = code.co_filename
        known = (filename[len(_state.root):], code.co_firstlineno) if filename.startswith(_state.root) else None
        _state.keys[code] = known
    if known is None:
        return None
    owner = getattr(method, "__self__", None)
    return known[0], known[1], type(owner).__name__ if owner is not None else "", getattr(function, "__name__", "?")


def _flush(force: bool = False) -> None:
    now = time.monotonic()
    if not force and now - _state.last_flush < _FLUSH_SECONDS:
        return
    _state.last_flush = now
    if not _state.calls and not _state.ignored:
        return
    payload = {
        "calls": [[*key, count] for key, count in _state.calls.items()],
        "ignored": [[event, list(existing), count] for (event, existing), count in _state.ignored.items()],
    }
    _state.calls.clear()
    _state.ignored.clear()
    if _state.notify:
        _state.notify("trace", payload)


def _record(method) -> None:
    where = _where(method)
    if where is not None:
        _state.calls[where] = _state.calls.get(where, 0) + 1


_KEY_PREFIXES = ("key_down_",)  # a key that is pressed and not answered; the release adds nothing
_CLICKS = {
    "mouse_left_down": ("on_mouse_left", "on_mouse_left_down", "on_clicked", "on_clicked_left"),
    "mouse_right_down": ("on_mouse_right", "on_mouse_right_down", "on_clicked", "on_clicked_right"),
}


def _check_input(handler, event: str) -> None:
    """Report an input that no registered method can answer."""
    registered = handler.event_registry.registered_event_names()
    if event in _CLICKS:
        if not any(name in registered for name in _CLICKS[event]):
            _note(event, ())
        return
    for prefix in _KEY_PREFIXES:
        if event.startswith(prefix):
            key = event[len(prefix):]
            kind = prefix[:-1]  # key_down / key_up
            generic = ("on_key_down", "on_key_pressed", "on_key_up")
            if any(name in registered for name in generic):
                return  # a general handler gets every key
            if f"on_{kind}_{key}" in registered or f"on_key_pressed_{key}" in registered or f"on_key_up_{key}" in registered or f"on_key_down_{key}" in registered:
                return
            _note(event, tuple(sorted(name for name in registered if name.startswith("on_key_")))[:6])
            return


def _note(event: str, existing: tuple) -> None:
    key = (event, existing)
    _state.ignored[key] = _state.ignored.get(key, 0) + 1
    _schedule()


def _schedule() -> None:
    """Nothing else may call in for a while (a world without `act`): send what is waiting a moment later."""
    if _state.scheduled:
        return
    try:
        import asyncio

        asyncio.get_running_loop().call_later(_FLUSH_SECONDS * 1.5, _later)
        _state.scheduled = True
    except RuntimeError:
        pass  # no event loop (a test): the next call flushes


def _later() -> None:
    _state.scheduled = False
    _flush(force=True)


def install(notify, root: str = "/project") -> None:
    """Wrap the engine's dispatch (once); `notify(kind, payload)` receives the batches."""
    _state.notify = notify
    _state.root = root.rstrip("/") + "/"
    reset()
    import miniworlds.tools.method_caller as method_caller
    from miniworlds.worlds.manager.event_handler import EventHandler

    if not getattr(method_caller, "_mw_traced", False):
        original_call = method_caller.call_method

        def traced_call(method, arguments, allow_none=True):
            if _state.on:
                _record(method)
                _flush()
            return original_call(method, arguments, allow_none)

        method_caller.call_method = traced_call
        method_caller._mw_traced = True
    if not getattr(EventHandler, "_mw_traced", False):
        original_handle = EventHandler.handle_event

        def traced_handle(self, event, data):
            if _state.on and (event in _CLICKS or event.startswith(_KEY_PREFIXES)):
                try:
                    _check_input(self, event)
                except Exception:  # noqa: BLE001 - a diagnostic must never break the program
                    pass
            return original_handle(self, event, data)

        EventHandler.handle_event = traced_handle
        EventHandler._mw_traced = True


def flush() -> None:
    _flush(force=True)

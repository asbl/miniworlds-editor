# Benchmark scenes, executed inside Pyodide. SCENE is set from JS.
import json, math, random, time
import os
import pygame
import miniworlds as mw

# FINDING: in a worker there is no AudioContext and the dummy SDL audio driver needs threads,
# so pygame.mixer.init() fails. Stub the mixer for this benchmark only.
if os.environ.get("SDL_AUDIODRIVER") == "dummy":
    pygame.mixer.init = lambda *a, **k: None
    pygame.mixer.quit = lambda *a, **k: None
    pygame.mixer.set_reserved = lambda *a, **k: None
    pygame.mixer.set_num_channels = lambda *a, **k: None

_stamps = []          # perf_counter() at every act() of the world
_input = {"key_down": 0, "mouse_down": 0}


def summary():
    deltas = [(b - a) * 1000 for a, b in zip(_stamps, _stamps[1:])]
    deltas.sort()
    n = len(deltas)
    span = (_stamps[-1] - _stamps[0]) if n else 0
    return json.dumps({
        "scene": SCENE,
        "frames": len(_stamps),
        "fps": round(n / span, 1) if span else 0,
        "p50_ms": round(deltas[n // 2], 1) if n else None,
        "p95_ms": round(deltas[int(n * 0.95)], 1) if n else None,
        "max_ms": round(deltas[-1], 1) if n else None,
        "input": _input,
    })


class Bench(mw.World):
    def on_setup(self):
        self.add_background((20, 20, 30))
        count = 150 if SCENE == "world" else 5
        for _ in range(count):
            Dot((random.randint(10, 390), random.randint(10, 290)))

    def act(self):
        _stamps.append(time.perf_counter())

    def on_key_down(self, keys):
        _input["key_down"] += 1

    def on_mouse_left(self, position):
        _input["mouse_down"] += 1


class Dot(mw.Circle):
    def __init__(self, position=(0, 0)):
        super().__init__(position, 6)
        self.fill_color = (200, 100, 50)
        self.direction = random.randint(0, 359)

    def act(self):
        self.move(2)
        self.turn_right(3)


world = Bench(400, 300)
world.fps = 60
world.run()

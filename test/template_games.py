"""Headless check that the game templates (weltraum, huepfer, schlange) really play.

Runs each template's main.py against a miniworlds checkout (no browser), steps the world frame by frame and asserts the
game logic: shooting, collisions, jumping and landing, eating and growing.

Usage: MINIWORLDS_SRC=~/code-git/miniworlds/source python test/template_games.py
Needs pygame-ce and the miniworlds sources importable (the environment of the miniworlds repo works).
"""
import asyncio, os, runpy, sys
from pathlib import Path

os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
os.environ.setdefault("SDL_AUDIODRIVER", "dummy")
sys.path.insert(0, os.path.expanduser(os.environ.get("MINIWORLDS_SRC", "~/code-git/miniworlds/source")))
from miniworlds import App, World  # noqa: E402

TEMPLATES = Path(__file__).resolve().parent.parent / "src" / "templates"
failures = []


def check(name, condition, detail=""):
    print(("ok   " if condition else "FAIL ") + name + (f"  [{detail}]" if detail and not condition else ""), flush=True)
    if not condition:
        failures.append(name)


def count(world, cls):
    return sum(type(a).__name__ == cls for a in world.actors)


async def load(name):
    folder = TEMPLATES / name
    for module in [m for m in sys.modules if m == "classes" or m.startswith("classes.")]:
        del sys.modules[module]
    os.chdir(folder)
    sys.path.insert(0, str(folder))
    App.reset(unittest=True, file=str(folder / "main.py"))
    World.run = lambda self, *a, **k: None
    ns = runpy.run_path(str(folder / "main.py"), run_name="__main__")
    sys.path.remove(str(folder))
    world, app = ns["welt"], ns["welt"].app
    app.platform.poll_events = lambda: []
    app.platform.get_mouse_pos = lambda: (0, 0)

    async def nap():
        await asyncio.sleep(0)

    app.platform.yield_mainloop = nap
    app._skip_frame_delay = True
    app.prepare_mainloop()
    world.backgrounds._init_display()
    world._mainloop.dirty_all()

    async def frames(n, each=None):
        for i in range(n):
            if each:
                each(i)
            await app._update()

    return ns, world, frames


async def weltraum():
    ns, world, frames = await load("weltraum")
    from classes.Asteroid import Asteroid
    ship = ns["schiff"]
    await frames(60)
    check("weltraum: asteroids appear on their own", count(world, "Asteroid") > 0)
    for a in [a for a in world.actors if type(a).__name__ == "Asteroid"]:
        a.remove()
    Asteroid((ship.x, 340))
    ship.on_key_down(["space"])
    await frames(10)  # short: the world spawns a new asteroid every 40th frame
    check("weltraum: a laser shot removes the asteroid and scores", world.punkte == 1 and count(world, "Asteroid") == 0, (world.punkte, count(world, "Asteroid")))
    Asteroid((ship.x, ship.y - 20))
    await frames(5)
    check("weltraum: touching an asteroid ends the game", world.zu_ende)


async def huepfer():
    ns, world, frames = await load("huepfer")
    player = ns["spieler"]
    await frames(40)
    check("huepfer: stands on the ground", player.am_boden and 280 < player.y < 290, player.y)
    player.on_key_down(["space"])
    await frames(3)
    check("huepfer: jumps", player.y < 280, player.y)
    await frames(60)
    check("huepfer: lands again", player.am_boden)
    player.position = (60, 285)
    await frames(2)
    player.on_key_down(["space"])
    for _ in range(40):
        player.on_key_pressed(["right"])
        await frames(1)
    check("huepfer: reaches the first platform and its coin", world.punkte >= 1, world.punkte)


async def schlange():
    ns, world, frames = await load("schlange")
    head, apple = ns["kopf"], ns["apfel"]
    await frames(40)
    check("schlange: head moves", head.x > 200, head.position)
    apple.position = (head.x + 20, head.y)
    await frames(16)
    check("schlange: eating grows the snake and scores", len(head.koerper) == 1 and world.punkte == 1)
    check("schlange: a new apple appears", count(world, "Apfel") == 1)
    head.richtung = (-20, 0)
    await frames(500)
    check("schlange: the wall ends the game", world.zu_ende)


async def main():
    await weltraum()
    await huepfer()
    await schlange()


asyncio.run(main())
print("FAILED: " + ", ".join(failures) if failures else "all game checks passed")
sys.exit(1 if failures else 0)

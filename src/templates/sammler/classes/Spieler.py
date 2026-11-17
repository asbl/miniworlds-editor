import miniworlds as mw
from classes.Muenze import Muenze


class Spieler(mw.Circle):
    def __init__(self, position=(0, 0)):
        super().__init__(position, 14)
        self.fill_color = (60, 110, 200)

    def act(self):
        for muenze in self.detect_all(Muenze):
            muenze.remove()
            self.world.punkt_dazu()

    def on_key_pressed(self, key):
        if "left" in key or "a" in key:
            self.x -= 3
        if "right" in key or "d" in key:
            self.x += 3
        if "up" in key or "w" in key:
            self.y -= 3
        if "down" in key or "s" in key:
            self.y += 3

import miniworlds as mw
from classes.Asteroid import Asteroid
from classes.Laser import Laser


class Raumschiff(mw.Rectangle):
    def __init__(self, position=(0, 0)):
        super().__init__(position, 30, 30)
        self.fill_color = (90, 200, 255)

    def act(self):
        if self.detect(Asteroid):
            self.world.spiel_vorbei()

    def on_key_pressed(self, key):
        if "left" in key or "a" in key:
            self.x = max(15, self.x - 5)
        if "right" in key or "d" in key:
            self.x = min(self.world.width - 15, self.x + 5)

    def on_key_down(self, key):
        if "space" in key:
            Laser((self.x, self.y - 24))

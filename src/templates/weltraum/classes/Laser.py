import miniworlds as mw
from classes.Asteroid import Asteroid


class Laser(mw.Rectangle):
    def __init__(self, position=(0, 0)):
        super().__init__(position, 4, 14)
        self.fill_color = (255, 90, 90)

    def act(self):
        self.y -= 9
        treffer = self.detect(Asteroid)
        if treffer:
            treffer.remove()
            self.world.punkt_dazu()
            self.remove()
        elif self.y < -20:
            self.remove()

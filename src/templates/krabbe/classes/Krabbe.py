import miniworlds as mw
from classes.Wurm import Wurm


class Krabbe(mw.Circle):
    def __init__(self, position=(0, 0)):
        super().__init__(position, 16)
        self.fill_color = (220, 70, 50)
        self.gefressen = 0

    def act(self):
        self.move(2)
        if not (0 < self.center_x < self.world.width and 0 < self.center_y < self.world.height):
            self.turn_left(180)
            self.move(6)
        for wurm in self.detect_all(Wurm):
            wurm.remove()
            self.fressen()

    def fressen(self, menge=1):
        self.gefressen += menge
        return self.gefressen

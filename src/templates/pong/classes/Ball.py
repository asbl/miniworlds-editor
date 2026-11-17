import miniworlds as mw
from classes.Schlaeger import Schlaeger


class Ball(mw.Circle):
    def __init__(self, position=(0, 0)):
        super().__init__(position, 10)
        self.fill_color = (240, 240, 240)
        self.direction = 60

    def act(self):
        self.move(4)
        rand = self.detect_borders()
        if rand:
            self.bounce_from_border(rand)
        if self.detect(Schlaeger):
            self.bounce_from_border(["left"])
            self.move(8)

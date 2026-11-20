import random
import miniworlds as mw


class Asteroid(mw.Circle):
    def __init__(self, position=(0, 0)):
        super().__init__(position, random.randint(10, 20))
        self.fill_color = (150, 140, 130)
        self.tempo = random.randint(2, 4)

    def act(self):
        self.y += self.tempo
        if self.y > self.world.height + 30:
            self.remove()

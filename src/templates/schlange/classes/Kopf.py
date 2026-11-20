import miniworlds as mw
from classes.Apfel import Apfel
from classes.Glied import Glied


class Kopf(mw.Rectangle):
    def __init__(self, position=(0, 0)):
        super().__init__(position, 18, 18)
        self.fill_color = (30, 110, 50)
        self.richtung = (20, 0)
        self.koerper = []

    def act(self):
        # Die Schlange bewegt sich nur alle 8 Bilder um ein Feld
        if self.world.frame % 8 != 0:
            return
        alte_position = (self.x, self.y)
        self.x += self.richtung[0]
        self.y += self.richtung[1]
        if self.ausserhalb() or self.detect(Glied):
            self.world.spiel_vorbei()
            return
        if self.koerper:
            letztes = self.koerper.pop()
            letztes.position = alte_position
            self.koerper.insert(0, letztes)
        if self.detect(Apfel):
            self.wachsen(alte_position)

    def wachsen(self, position):
        for apfel in self.detect_all(Apfel):
            apfel.remove()
        self.koerper.append(Glied(position))
        self.world.neuer_apfel()

    def ausserhalb(self):
        return self.x < 10 or self.y < 10 or self.x > self.world.width - 10 or self.y > self.world.height - 10

    def on_key_down(self, key):
        if "left" in key and self.richtung[0] == 0:
            self.richtung = (-20, 0)
        if "right" in key and self.richtung[0] == 0:
            self.richtung = (20, 0)
        if "up" in key and self.richtung[1] == 0:
            self.richtung = (0, -20)
        if "down" in key and self.richtung[1] == 0:
            self.richtung = (0, 20)
